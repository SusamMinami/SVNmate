from __future__ import annotations

import os
import subprocess
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


CommandFactory = Callable[[Path], list[str]]
EventSink = Callable[["UpdateEvent"], None]
OutputSink = Callable[[str], None]
WorkingCopyResolver = Callable[[Path], Path]
MAX_PARALLEL_WORKING_COPIES = 2


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def needs_process_restart(message: str) -> bool:
    normalized = message.casefold()
    return any(
        marker in normalized
        for marker in (
            "winerror 6",
            "句柄无效",
            "invalid handle",
            "bad file descriptor",
        )
    )


@dataclass(frozen=True)
class CommandExecution:
    return_code: int
    output: str = ""
    error: str = ""
    elapsed_seconds: float = 0.0

    @property
    def success(self) -> bool:
        return self.return_code == 0

    @property
    def message(self) -> str:
        return self.error or self.output or f"退出码 {self.return_code}"


@dataclass(frozen=True)
class UpdateEvent:
    folder: str
    action: str
    status: str
    message: str = ""


@dataclass(frozen=True)
class UpdateStepResult:
    action: str
    command: tuple[str, ...]
    return_code: int
    elapsed_seconds: float
    message: str

    @property
    def success(self) -> bool:
        return self.return_code == 0


@dataclass(frozen=True)
class WorkspaceUpdateResult:
    folder: str
    success: bool
    status: str
    update_attempts: int
    cleanup_attempted: bool
    steps: tuple[UpdateStepResult, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class BatchUpdateResult:
    request_id: str
    started_at: str
    finished_at: str
    folders: tuple[WorkspaceUpdateResult, ...]

    @property
    def success(self) -> bool:
        return bool(self.folders) and all(item.success for item in self.folders)

    @property
    def status(self) -> str:
        if self.success:
            return "completed"
        if any(item.success for item in self.folders):
            return "partial"
        return "failed"

    def to_dict(self, *, executed_by: str) -> dict[str, object]:
        return {
            "protocol_version": 1,
            "request_id": self.request_id,
            "command": "update",
            "executed_by": executed_by,
            "ok": self.success,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "folders": [item.to_dict() for item in self.folders],
        }


class StreamingCommandExecutor:
    def __init__(
        self,
        output_sink: OutputSink | None = None,
        *,
        output_tail_lines: int = 80,
    ) -> None:
        self.output_sink = output_sink
        self.output_tail_lines = output_tail_lines

    def __call__(
        self,
        cwd: Path,
        command: Sequence[str],
        _action: str,
    ) -> CommandExecution:
        started = time.monotonic()
        try:
            process = subprocess.Popen(
                list(command),
                cwd=str(cwd),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                errors="replace",
                shell=False,
                creationflags=self._creation_flags(),
                close_fds=True,
            )
        except FileNotFoundError as exc:
            return CommandExecution(
                return_code=-1,
                error=f"命令不存在：{exc.filename}",
                elapsed_seconds=time.monotonic() - started,
            )
        except OSError as exc:
            return CommandExecution(
                return_code=-1,
                error=str(exc),
                elapsed_seconds=time.monotonic() - started,
            )

        output_tail: deque[str] = deque(maxlen=self.output_tail_lines)
        if process.stdout is not None:
            with process.stdout:
                for raw_line in process.stdout:
                    line = raw_line.rstrip()
                    if not line:
                        continue
                    if self.output_sink is not None:
                        self.output_sink(line)
                    output_tail.append(line[-2000:])
        return CommandExecution(
            return_code=process.wait(),
            output="\n".join(output_tail),
            elapsed_seconds=time.monotonic() - started,
        )

    @staticmethod
    def _creation_flags() -> int:
        if os.name == "nt":
            return subprocess.CREATE_NO_WINDOW
        return 0


class WorkspaceUpdateService:
    def __init__(
        self,
        *,
        executor: Callable[[Path, Sequence[str], str], CommandExecution],
        update_command: CommandFactory,
        cleanup_command: CommandFactory,
        event_sink: EventSink | None = None,
        max_parallel_working_copies: int = MAX_PARALLEL_WORKING_COPIES,
        working_copy_resolver: WorkingCopyResolver | None = None,
    ) -> None:
        self.executor = executor
        self.update_command = update_command
        self.cleanup_command = cleanup_command
        self.event_sink = event_sink
        self.max_parallel_working_copies = max(
            1,
            int(max_parallel_working_copies),
        )
        self.working_copy_resolver = (
            working_copy_resolver or find_working_copy_root
        )

    def update_folder(
        self,
        folder: Path | str,
        *,
        explicit_update_command: Sequence[str] | None = None,
        validate_folder: bool = True,
    ) -> WorkspaceUpdateResult:
        target = Path(folder)
        if validate_folder and (not target.exists() or not target.is_dir()):
            self._emit(target, "检查文件夹", "失败", "文件夹不存在")
            return WorkspaceUpdateResult(
                folder=str(target),
                success=False,
                status="missing",
                update_attempts=0,
                cleanup_attempted=False,
            )

        update_command = list(
            explicit_update_command
            if explicit_update_command is not None
            else self.update_command(target)
        )
        steps: list[UpdateStepResult] = []

        first_update = self._execute_step(
            target,
            update_command,
            "svn update",
            steps,
        )
        if first_update.success:
            return WorkspaceUpdateResult(
                folder=str(target),
                success=True,
                status="updated",
                update_attempts=1,
                cleanup_attempted=False,
                steps=tuple(steps),
            )

        failure_message = first_update.message
        if needs_process_restart(failure_message):
            self._emit(
                target,
                "svn update",
                "自动重启",
                "检测到 Windows 进程句柄无效，停止本轮更新并重启 SVNmate",
            )
            return WorkspaceUpdateResult(
                folder=str(target),
                success=False,
                status="restart-required",
                update_attempts=1,
                cleanup_attempted=False,
                steps=tuple(steps),
            )
        if needs_svn_cleanup(failure_message):
            recovery_message = "SVN 提示工作副本需要清理，正在执行 cleanup"
        else:
            recovery_message = (
                f"SVN Update 失败（{failure_message[:160]}），"
                "先执行 cleanup 后重试一次"
            )
        self._emit(target, "svn update", "自动恢复", recovery_message)

        cleanup = self._execute_step(
            target,
            self.cleanup_command(target),
            "svn cleanup(自动恢复)",
            steps,
        )
        if not cleanup.success:
            self._emit(
                target,
                "svn update",
                "失败",
                "自动 cleanup 失败，已停止重试",
            )
            return WorkspaceUpdateResult(
                folder=str(target),
                success=False,
                status="cleanup-failed",
                update_attempts=1,
                cleanup_attempted=True,
                steps=tuple(steps),
            )

        self._emit(
            target,
            "svn update",
            "重试",
            "cleanup 完成，重新执行 svn update",
        )
        retry = self._execute_step(
            target,
            update_command,
            "svn update",
            steps,
        )
        return WorkspaceUpdateResult(
            folder=str(target),
            success=retry.success,
            status="updated-after-cleanup" if retry.success else "update-failed",
            update_attempts=2,
            cleanup_attempted=True,
            steps=tuple(steps),
        )

    def update_folders(
        self,
        folders: Iterable[Path | str],
        *,
        request_id: str | None = None,
    ) -> BatchUpdateResult:
        started_at = _utc_now()
        targets = dedupe_folders(folders)
        indexed_targets = tuple(enumerate(targets))
        grouped_targets: dict[str, list[tuple[int, Path]]] = {}
        for index, target in indexed_targets:
            root = self.working_copy_resolver(target)
            key = (
                normalized_path_key(root)
                if (root / ".svn").is_dir()
                else "__unresolved_working_copy__"
            )
            grouped_targets.setdefault(key, []).append((index, target))

        stop_requested = threading.Event()
        indexed_results: dict[int, WorkspaceUpdateResult] = {}

        def update_working_copy_group(
            group: list[tuple[int, Path]],
        ) -> list[tuple[int, WorkspaceUpdateResult]]:
            group_results: list[tuple[int, WorkspaceUpdateResult]] = []
            for index, target in group:
                if stop_requested.is_set():
                    break
                result = self.update_folder(target)
                group_results.append((index, result))
                if result.status == "restart-required":
                    stop_requested.set()
                    break
            return group_results

        groups = list(grouped_targets.values())
        if groups:
            worker_count = min(
                self.max_parallel_working_copies,
                len(groups),
            )
            with ThreadPoolExecutor(
                max_workers=worker_count,
                thread_name_prefix="svnmate-wc",
            ) as executor:
                futures = [
                    executor.submit(update_working_copy_group, group)
                    for group in groups
                ]
                for future in futures:
                    for index, result in future.result():
                        indexed_results[index] = result

        results = tuple(
            indexed_results[index]
            for index, _target in indexed_targets
            if index in indexed_results
        )
        return BatchUpdateResult(
            request_id=request_id or str(uuid.uuid4()),
            started_at=started_at,
            finished_at=_utc_now(),
            folders=results,
        )

    def _execute_step(
        self,
        folder: Path,
        command: Sequence[str],
        action: str,
        steps: list[UpdateStepResult],
    ) -> CommandExecution:
        self._emit(folder, action, "开始", "")
        started = time.monotonic()
        try:
            execution = self.executor(folder, command, action)
        except FileNotFoundError as exc:
            execution = CommandExecution(
                return_code=-1,
                error=f"命令不存在：{exc.filename}",
                elapsed_seconds=time.monotonic() - started,
            )
        except OSError as exc:
            execution = CommandExecution(
                return_code=-1,
                error=str(exc),
                elapsed_seconds=time.monotonic() - started,
            )
        except Exception as exc:
            execution = CommandExecution(
                return_code=-1,
                error=f"{type(exc).__name__}: {exc}",
                elapsed_seconds=time.monotonic() - started,
            )

        elapsed = execution.elapsed_seconds or (time.monotonic() - started)
        message = (
            f"耗时 {elapsed:.1f}s"
            if execution.success
            else execution.message[:300]
        )
        steps.append(
            UpdateStepResult(
                action=action,
                command=tuple(command),
                return_code=execution.return_code,
                elapsed_seconds=elapsed,
                message=message,
            )
        )
        self._emit(
            folder,
            action,
            "成功" if execution.success else "失败",
            message,
        )
        return execution

    def _emit(
        self,
        folder: Path,
        action: str,
        status: str,
        message: str,
    ) -> None:
        if self.event_sink is not None:
            self.event_sink(
                UpdateEvent(
                    folder=str(folder),
                    action=action,
                    status=status,
                    message=message,
                )
            )


def create_cli_update_service(
    *,
    svn_executable: str = "svn",
    event_sink: EventSink | None = None,
    output_sink: OutputSink | None = None,
) -> WorkspaceUpdateService:
    return WorkspaceUpdateService(
        executor=StreamingCommandExecutor(output_sink),
        update_command=lambda _folder: [svn_executable, "update"],
        cleanup_command=lambda _folder: [svn_executable, "cleanup"],
        event_sink=event_sink,
    )


def dedupe_folders(folders: Iterable[Path | str]) -> tuple[Path, ...]:
    seen: set[str] = set()
    result: list[Path] = []
    for folder in folders:
        path = Path(folder).expanduser()
        key = normalized_path_key(path)
        if key in seen:
            continue
        seen.add(key)
        result.append(path)
    return tuple(result)


def normalized_path_key(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


def find_working_copy_root(folder: Path | str) -> Path:
    target = Path(folder).expanduser()
    try:
        resolved = target.resolve(strict=False)
    except OSError:
        resolved = Path(os.path.abspath(str(target)))

    probe = resolved if resolved.is_dir() else resolved.parent
    for candidate in (probe, *probe.parents):
        if (candidate / ".svn").is_dir():
            return candidate
    return resolved


def needs_svn_cleanup(message: str) -> bool:
    normalized = message.lower()
    keywords = (
        "run 'svn cleanup'",
        "run svn cleanup",
        "run 'cleanup'",
        "working copy locked",
        "previous operation has not finished",
        "please execute the 'cleanup' command",
        "e155004",
        "e155037",
        "需要先执行",
        "执行清理",
        "工作副本被锁定",
    )
    return any(keyword in normalized for keyword in keywords)
