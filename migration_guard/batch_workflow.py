from __future__ import annotations

import os
import shutil
import subprocess
from collections import defaultdict
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

from .models import (
    BatchMigrationAuditResult,
    FileVerification,
    VerificationState,
    WorkspaceModule,
)
from .ue_client import UnrealMcpClient, UnrealMigrationResult


ProgressSink = Callable[[str, str], None]
ProcessLauncher = Callable[[list[str]], subprocess.Popen[bytes]]


@dataclass(frozen=True)
class AssetMigrationItem:
    package_name: str
    source_local_path: str
    target_local_path: str
    source_issues: tuple[str, ...]
    target_issues: tuple[str, ...]


@dataclass(frozen=True)
class AssetMigrationPlan:
    assets: tuple[AssetMigrationItem, ...]
    manual_files: tuple[FileVerification, ...]
    already_handled_count: int

    @property
    def package_names(self) -> tuple[str, ...]:
        return tuple(item.package_name for item in self.assets)


@dataclass(frozen=True)
class CheckoutGroup:
    target_issue: str
    message: str
    paths: tuple[str, ...]


@dataclass(frozen=True)
class CheckoutPlan:
    groups: tuple[CheckoutGroup, ...]
    ambiguous_paths: tuple[str, ...]

    @property
    def path_count(self) -> int:
        return sum(len(group.paths) for group in self.groups)


@dataclass(frozen=True)
class CheckoutLaunchResult:
    opened_groups: tuple[CheckoutGroup, ...]
    return_codes: tuple[int, ...]


class BatchMigrationExecutor:
    def __init__(
        self,
        *,
        ue: UnrealMcpClient | None = None,
        progress: ProgressSink | None = None,
        tortoise_executable: str | None = None,
        process_launcher: ProcessLauncher | None = None,
    ) -> None:
        self.ue = ue or UnrealMcpClient()
        self.progress = progress
        self.tortoise_executable = (
            tortoise_executable or _find_tortoise_proc()
        )
        self.process_launcher = process_launcher or _launch_process

    def build_asset_plan(
        self,
        result: BatchMigrationAuditResult,
        modules: tuple[WorkspaceModule, ...],
    ) -> AssetMigrationPlan:
        blocking = [
            item
            for item in result.files
            if item.state in {
                VerificationState.BLOCKED,
                VerificationState.NEEDS_UPDATE,
            }
        ]
        if blocking:
            first = blocking[0]
            raise ValueError(
                "批量迁移前仍有阻断或需更新文件："
                f"{first.expected.target_local_path or first.expected.source_path}"
            )

        module_by_name = {item.name.casefold(): item for item in modules}
        assets: dict[str, list[FileVerification]] = defaultdict(list)
        manual_files = []
        already_handled = 0
        for item in result.files:
            if item.state != VerificationState.NOT_MIGRATED:
                already_handled += 1
                continue
            expected = item.expected
            module = module_by_name.get(expected.module.casefold())
            package_name = (
                _package_name(expected.source_local_path, module)
                if module is not None
                else ""
            )
            if (
                expected.action != "D"
                and package_name
                and Path(expected.source_local_path).is_file()
            ):
                assets[package_name.casefold()].append(item)
            else:
                manual_files.append(item)

        planned = []
        for owned_files in assets.values():
            representative = owned_files[0].expected
            planned.append(
                AssetMigrationItem(
                    package_name=_package_name(
                        representative.source_local_path,
                        module_by_name[representative.module.casefold()],
                    ),
                    source_local_path=representative.source_local_path,
                    target_local_path=representative.target_local_path,
                    source_issues=tuple(
                        dict.fromkeys(
                            item.expected.source_issue
                            for item in owned_files
                        )
                    ),
                    target_issues=tuple(
                        dict.fromkeys(
                            item.expected.target_issue
                            for item in owned_files
                        )
                    ),
                )
            )
        return AssetMigrationPlan(
            assets=tuple(
                sorted(planned, key=lambda item: item.package_name.casefold())
            ),
            manual_files=tuple(manual_files),
            already_handled_count=already_handled,
        )

    def migrate(
        self,
        plan: AssetMigrationPlan,
        modules: tuple[WorkspaceModule, ...],
        *,
        target_branch_dir: Path,
    ) -> UnrealMigrationResult | None:
        if not plan.assets:
            self._progress("migrate", "没有需要执行的 UE 资源迁移")
            return None
        res_module = next(
            (
                module
                for module in modules
                if module.name.casefold() == "res"
            ),
            None,
        )
        if res_module is None:
            raise ValueError("批量 UE 迁移需要启用 res 模块")
        self._progress(
            "migrate",
            f"一次迁移 {len(plan.assets)} 个 UE 资源",
        )
        return self.ue.migrate_packages(
            plan.package_names,
            source_content_dir=res_module.source_path / "Content",
            target_branch_dir=target_branch_dir,
        )

    def select_assets(
        self,
        plan: AssetMigrationPlan,
        package_names: tuple[str, ...],
    ) -> AssetMigrationPlan:
        selected = {
            package_name.casefold()
            for package_name in package_names
        }
        return AssetMigrationPlan(
            assets=tuple(
                item
                for item in plan.assets
                if item.package_name.casefold() in selected
            ),
            manual_files=plan.manual_files,
            already_handled_count=plan.already_handled_count,
        )

    def build_checkout_plan(
        self,
        result: BatchMigrationAuditResult,
        commit_messages: Mapping[str, str],
    ) -> CheckoutPlan:
        owners_by_path: dict[str, set[str]] = defaultdict(set)
        display_paths: dict[str, str] = {}
        for item in result.files:
            if item.state != VerificationState.PENDING_COMMIT:
                continue
            path = item.expected.target_local_path
            if not path:
                continue
            key = _path_key(path)
            owners_by_path[key].add(item.expected.target_issue)
            display_paths[key] = path

        grouped: dict[str, list[str]] = defaultdict(list)
        ambiguous = []
        for key, owners in owners_by_path.items():
            path = display_paths[key]
            if len(owners) != 1:
                ambiguous.append(path)
                continue
            grouped[next(iter(owners))].append(path)

        groups = []
        for target_issue, paths in grouped.items():
            groups.append(
                CheckoutGroup(
                    target_issue=target_issue,
                    message=commit_messages.get(
                        target_issue,
                        f"【{target_issue}】",
                    ),
                    paths=tuple(sorted(paths, key=str.casefold)),
                )
            )
        return CheckoutPlan(
            groups=tuple(
                sorted(groups, key=lambda item: item.target_issue)
            ),
            ambiguous_paths=tuple(
                sorted(ambiguous, key=str.casefold)
            ),
        )

    def open_checkout_windows(
        self,
        plan: CheckoutPlan,
        *,
        wait: bool = True,
    ) -> CheckoutLaunchResult:
        if plan.ambiguous_paths:
            raise ValueError(
                "存在同时归属多个 Jira 的目标改动，"
                "已停止自动准备提交窗口"
            )
        if not plan.groups:
            self._progress("checkout", "没有待提交文件")
            return CheckoutLaunchResult((), ())
        if not self.tortoise_executable:
            raise FileNotFoundError("未找到 TortoiseProc.exe")

        processes = []
        opened_groups = []
        for group in plan.groups:
            for paths in _chunk_paths(group.paths):
                self._progress(
                    "checkout",
                    f"准备 {group.target_issue}：{len(paths)} 个文件",
                )
                command = [
                    self.tortoise_executable,
                    "/command:commit",
                    f"/path:{'*'.join(paths)}",
                    f"/logmsg:{group.message}",
                    "/closeonend:0",
                ]
                processes.append(self.process_launcher(command))
                opened_groups.append(
                    CheckoutGroup(
                        target_issue=group.target_issue,
                        message=group.message,
                        paths=paths,
                    )
                )
        return_codes = ()
        if wait:
            self._progress(
                "checkout",
                f"等待 {len(processes)} 个提交窗口关闭",
            )
            return_codes = tuple(process.wait() for process in processes)
        return CheckoutLaunchResult(
            opened_groups=tuple(opened_groups),
            return_codes=return_codes,
        )

    def _progress(self, stage: str, message: str) -> None:
        if self.progress is not None:
            self.progress(stage, message)


def _package_name(
    source_local_path: str,
    module: WorkspaceModule | None,
) -> str:
    if module is None:
        return ""
    source = Path(source_local_path)
    if source.suffix.casefold() not in {".uasset", ".umap"}:
        return ""
    try:
        relative = source.resolve().relative_to(
            (module.source_path / "Content").resolve()
        )
    except (OSError, ValueError):
        return ""
    return "/Game/" + relative.with_suffix("").as_posix()


def _find_tortoise_proc() -> str:
    discovered = shutil.which("TortoiseProc.exe") or shutil.which(
        "TortoiseProc"
    )
    if discovered:
        return discovered
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    candidate = Path(program_files) / "TortoiseSVN" / "bin" / "TortoiseProc.exe"
    return str(candidate) if candidate.is_file() else ""


def _chunk_paths(
    paths: tuple[str, ...],
    *,
    max_items: int = 80,
    max_characters: int = 24000,
) -> tuple[tuple[str, ...], ...]:
    chunks = []
    current = []
    current_length = 0
    for path in paths:
        additional = len(path) + 1
        if current and (
            len(current) >= max_items
            or current_length + additional > max_characters
        ):
            chunks.append(tuple(current))
            current = []
            current_length = 0
        current.append(path)
        current_length += additional
    if current:
        chunks.append(tuple(current))
    return tuple(chunks)


def _path_key(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))


def _launch_process(command: list[str]) -> subprocess.Popen[bytes]:
    return subprocess.Popen(command)
