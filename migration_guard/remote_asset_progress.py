from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from threading import Event

from .config import default_data_directory
from .models import SvnCommit
from .svn_client import (
    SvnClient,
    SvnCommandOutput,
    message_has_issue,
)
from .ticket_mapping import TicketMapping, TicketRoute


DOMESTIC = "domestic"
OVERSEAS_TRUNK = "overseas_trunk"
OSOB = "osob"
STAGES = (DOMESTIC, OVERSEAS_TRUNK, OSOB)
STAGE_LABELS = {
    DOMESTIC: "国内 trunk",
    OVERSEAS_TRUNK: "海外 trunk",
    OSOB: "海外 OB",
}
REMOTE_CACHE_SCHEMA_VERSION = 1
REMOTE_CACHE_SECONDS = 300


@dataclass(frozen=True)
class RemoteRepository:
    stage: str
    module: str
    url: str
    repository_path: str


DEFAULT_REMOTE_REPOSITORIES = (
    RemoteRepository(
        DOMESTIC,
        "res",
        "http://svn-oasis.bytedance.net/lvzhou_game/"
        "Project-6/res/trunk",
        "/Project-6/res/trunk",
    ),
    RemoteRepository(
        DOMESTIC,
        "doc",
        "http://svn-oasis.bytedance.net/lvzhou_game/"
        "Project-6/doc/trunk/data",
        "/Project-6/doc/trunk/data",
    ),
    RemoteRepository(
        DOMESTIC,
        "bin",
        "http://svn-oasis.bytedance.net/lvzhou_game/"
        "Project-6/bin/trunk",
        "/Project-6/bin/trunk",
    ),
    RemoteRepository(
        OVERSEAS_TRUNK,
        "res",
        "http://svn.bytedance.com/lvzhou_game/"
        "Project-6/res/overseas/trunk",
        "/Project-6/res/overseas/trunk",
    ),
    RemoteRepository(
        OVERSEAS_TRUNK,
        "doc",
        "http://svn.bytedance.com/lvzhou_game/"
        "Project-6/doc/overseas/trunk/data",
        "/Project-6/doc/overseas/trunk/data",
    ),
    RemoteRepository(
        OVERSEAS_TRUNK,
        "bin",
        "http://svn.bytedance.com/lvzhou_game/"
        "Project-6/bin/overseas/trunk",
        "/Project-6/bin/overseas/trunk",
    ),
    RemoteRepository(
        OSOB,
        "res",
        "http://svn-oasis.bytedance.net/lvzhou_game/"
        "Project-6/res/overseas/branches/OSOB2",
        "/Project-6/res/overseas/branches/OSOB2",
    ),
    RemoteRepository(
        OSOB,
        "doc",
        "http://svn-oasis.bytedance.net/lvzhou_game/"
        "Project-6/doc/overseas/branches/OSOB2/data",
        "/Project-6/doc/overseas/branches/OSOB2/data",
    ),
    RemoteRepository(
        OSOB,
        "bin",
        "http://svn.bytedance.com/lvzhou_game/"
        "Project-6/bin/overseas/branches/OSOB2",
        "/Project-6/bin/overseas/branches/OSOB2",
    ),
)


@dataclass(frozen=True)
class BranchEvidence:
    revisions: tuple[int, ...] = ()
    authors: tuple[str, ...] = ()
    action: str = ""

    @property
    def present(self) -> bool:
        return bool(self.revisions)

    @property
    def short_label(self) -> str:
        if not self.revisions:
            return "-"
        return f"{self.action or '?'} r{self.revisions[-1]}"


@dataclass(frozen=True)
class RemoteAssetProgress:
    module: str
    relative_path: str
    display_path: str
    source_issues: tuple[str, ...]
    target_issues: tuple[str, ...]
    domestic: BranchEvidence = field(default_factory=BranchEvidence)
    overseas_trunk: BranchEvidence = field(default_factory=BranchEvidence)
    osob: BranchEvidence = field(default_factory=BranchEvidence)

    @property
    def stage_label(self) -> str:
        if self.osob.present:
            return "海外 OB"
        if self.overseas_trunk.present:
            return "海外 trunk"
        if self.domestic.present:
            return "国内 trunk"
        return "无提交"

    @property
    def has_action_mismatch(self) -> bool:
        evidence = tuple(
            item
            for item in (
                self.domestic,
                self.overseas_trunk,
                self.osob,
            )
            if item.present
        )
        delete_states = {
            item.action == "D"
            for item in evidence
            if item.action
        }
        return len(delete_states) > 1


@dataclass(frozen=True)
class RemoteAssetProgressResult:
    assets: tuple[RemoteAssetProgress, ...]
    warnings: tuple[str, ...] = ()
    query_start: str = ""
    from_cache: bool = False
    cached_at: str = ""
    elapsed_seconds: float = 0.0

    @property
    def counts(self) -> dict[str, int]:
        counts = {stage: 0 for stage in STAGES}
        for asset in self.assets:
            if asset.domestic.present:
                counts[DOMESTIC] += 1
            if asset.overseas_trunk.present:
                counts[OVERSEAS_TRUNK] += 1
            if asset.osob.present:
                counts[OSOB] += 1
        return counts


@dataclass
class _EvidenceAccumulator:
    revisions: set[int] = field(default_factory=set)
    authors: set[str] = field(default_factory=set)
    actions: list[tuple[int, str]] = field(default_factory=list)

    def freeze(self) -> BranchEvidence:
        return BranchEvidence(
            revisions=tuple(sorted(self.revisions)),
            authors=tuple(sorted(self.authors)),
            action=max(self.actions)[1] if self.actions else "",
        )


@dataclass
class _AssetAccumulator:
    module: str
    relative_path: str
    source_issues: set[str] = field(default_factory=set)
    target_issues: set[str] = field(default_factory=set)
    evidence: dict[str, BranchEvidence] = field(default_factory=dict)


ProgressSink = Callable[[str, str], None]


class RemoteAssetScanCancelled(RuntimeError):
    pass


class RemoteAssetProgressCache:
    def __init__(
        self,
        directory: Path | None = None,
        *,
        ttl_seconds: int = REMOTE_CACHE_SECONDS,
    ) -> None:
        self.directory = (
            directory
            or default_data_directory() / "remote_asset_cache"
        )
        self.ttl_seconds = ttl_seconds

    def key(
        self,
        mappings: Iterable[TicketMapping],
        modules: Iterable[str],
        start: date,
        repositories: Iterable[RemoteRepository],
    ) -> str:
        payload = {
            "schema": REMOTE_CACHE_SCHEMA_VERSION,
            "mappings": sorted(
                {
                    (
                        item.source_issue,
                        item.target_issue,
                        item.route.value,
                    )
                    for item in mappings
                }
            ),
            "modules": sorted(set(modules)),
            "start": start.isoformat(),
            "repositories": [
                (item.stage, item.module, item.url)
                for item in repositories
            ],
        }
        encoded = json.dumps(
            payload,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def load(self, key: str) -> RemoteAssetProgressResult | None:
        path = self.directory / f"{key}.json"
        if not path.is_file():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            saved_at = float(payload.get("saved_at", 0))
            if time.time() - saved_at > self.ttl_seconds:
                path.unlink(missing_ok=True)
                return None
            result = _result_from_dict(payload.get("result"))
            return RemoteAssetProgressResult(
                assets=result.assets,
                warnings=result.warnings,
                query_start=result.query_start,
                from_cache=True,
                cached_at=datetime.fromtimestamp(
                    saved_at,
                    tz=timezone.utc,
                ).isoformat(),
                elapsed_seconds=0.0,
            )
        except (
            OSError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
        ):
            return None

    def save(
        self,
        key: str,
        result: RemoteAssetProgressResult,
    ) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        target = self.directory / f"{key}.json"
        temporary = target.with_suffix(".json.tmp")
        payload = {
            "schema": REMOTE_CACHE_SCHEMA_VERSION,
            "saved_at": time.time(),
            "result": _result_to_dict(result),
        }
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(temporary, target)
        self._prune()

    def _prune(self) -> None:
        cutoff = time.time() - self.ttl_seconds
        for path in self.directory.glob("*.json"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
            except OSError:
                continue


def create_cancellable_svn_runner(
    cancel_event: Event,
) -> Callable[[Sequence[str], Path | None, float], SvnCommandOutput]:
    def run(
        command: Sequence[str],
        cwd: Path | None,
        timeout: float,
    ) -> SvnCommandOutput:
        command_list = [str(value) for value in command]
        started = time.monotonic()
        creation_flags = (
            subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        )
        try:
            process = subprocess.Popen(
                command_list,
                cwd=str(cwd) if cwd else None,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=creation_flags,
            )
        except FileNotFoundError as exc:
            return SvnCommandOutput(
                command=tuple(command_list),
                return_code=-1,
                stdout="",
                stderr=f"命令不存在：{exc.filename}",
                elapsed_seconds=time.monotonic() - started,
            )
        while True:
            try:
                stdout, stderr = process.communicate(timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                elapsed = time.monotonic() - started
                if cancel_event.is_set():
                    process.terminate()
                    stdout, stderr = process.communicate()
                    return SvnCommandOutput(
                        command=tuple(command_list),
                        return_code=-2,
                        stdout=_decode_output(stdout),
                        stderr="远端资产查询已取消",
                        elapsed_seconds=elapsed,
                    )
                if elapsed >= timeout:
                    process.kill()
                    stdout, stderr = process.communicate()
                    return SvnCommandOutput(
                        command=tuple(command_list),
                        return_code=-1,
                        stdout=_decode_output(stdout),
                        stderr=f"SVN 命令超过 {timeout:.0f} 秒未完成",
                        elapsed_seconds=elapsed,
                    )
        return SvnCommandOutput(
            command=tuple(command_list),
            return_code=process.returncode,
            stdout=_decode_output(stdout),
            stderr=_decode_output(stderr),
            elapsed_seconds=time.monotonic() - started,
        )

    return run


class RemoteAssetProgressService:
    def __init__(
        self,
        svn: SvnClient | None = None,
        *,
        repositories: Iterable[RemoteRepository] = (
            DEFAULT_REMOTE_REPOSITORIES
        ),
        progress: ProgressSink | None = None,
        cache: RemoteAssetProgressCache | None = None,
        cancel_event: Event | None = None,
    ) -> None:
        self.svn = svn or SvnClient()
        self.repositories = tuple(repositories)
        self.progress = progress
        self.cache = cache
        self.cancel_event = cancel_event

    def scan(
        self,
        mappings: Iterable[TicketMapping],
        *,
        enabled_modules: Iterable[str] = ("res", "doc", "bin"),
        lookback_days: int = 90,
        start_date: date | None = None,
        force_refresh: bool = False,
    ) -> RemoteAssetProgressResult:
        started = time.monotonic()
        mapping_list = tuple(mappings)
        modules = tuple(dict.fromkeys(enabled_modules))
        if not mapping_list:
            return RemoteAssetProgressResult(())
        if lookback_days < 1 or lookback_days > 3650:
            raise ValueError("查询天数必须在 1 到 3650 之间")
        self._check_cancelled()

        issues_by_stage = {
            DOMESTIC: tuple(
                dict.fromkeys(
                    mapping.source_issue
                    for mapping in mapping_list
                    if mapping.route == TicketRoute.DOMESTIC_TO_OVERSEAS
                )
            ),
            OVERSEAS_TRUNK: tuple(
                dict.fromkeys(
                    mapping.target_issue or mapping.source_issue
                    for mapping in mapping_list
                )
            ),
            OSOB: tuple(
                dict.fromkeys(
                    mapping.target_issue or mapping.source_issue
                    for mapping in mapping_list
                )
            ),
        }
        repositories = tuple(
            item
            for item in self.repositories
            if item.module in modules and issues_by_stage[item.stage]
        )
        earliest_allowed = date.today() - timedelta(days=lookback_days)
        start = max(start_date or earliest_allowed, earliest_allowed)
        start = min(start, date.today())
        cache_key = (
            self.cache.key(
                mapping_list,
                modules,
                start,
                repositories,
            )
            if self.cache is not None
            else ""
        )
        if self.cache is not None and not force_refresh:
            cached = self.cache.load(cache_key)
            if cached is not None:
                self._progress(
                    "remote-assets-cache",
                    f"命中资产缓存（起点 {start.isoformat()}）",
                )
                return cached
        evidence: dict[
            tuple[str, str, str, str],
            BranchEvidence,
        ] = {}
        warnings: list[str] = []

        def query(
            repository: RemoteRepository,
        ) -> tuple[RemoteRepository, tuple[SvnCommit, ...]]:
            self._check_cancelled()
            issues = issues_by_stage[repository.stage]
            self._progress(
                "remote-assets",
                f"读取 {STAGE_LABELS[repository.stage]} "
                f"{repository.module}（{len(issues)} 单）",
            )
            commits = self.svn.log_by_issues(
                repository.url,
                issues,
                start=start,
            )
            self._check_cancelled()
            self._progress(
                "remote-assets",
                f"{STAGE_LABELS[repository.stage]} "
                f"{repository.module} 完成（{len(commits)} 次提交）",
            )
            return repository, commits

        with ThreadPoolExecutor(
            max_workers=min(6, len(repositories)) or 1,
            thread_name_prefix="migration-remote-svn",
        ) as executor:
            futures = {
                executor.submit(query, repository): repository
                for repository in repositories
            }
            for future in as_completed(futures):
                self._check_cancelled()
                repository = futures[future]
                try:
                    _, commits = future.result()
                    evidence.update(
                        _collect_evidence(
                            repository,
                            commits,
                            issues_by_stage[repository.stage],
                        )
                    )
                except Exception as exc:
                    if self._cancelled():
                        raise RemoteAssetScanCancelled(
                            "远端资产查询已取消"
                        ) from exc
                    warnings.append(
                        f"{STAGE_LABELS[repository.stage]} "
                        f"{repository.module}：{exc}"
                    )

        assets: dict[tuple[str, str], _AssetAccumulator] = {}
        for mapping in mapping_list:
            target_issue = mapping.target_issue or mapping.source_issue
            issue_by_stage = {
                DOMESTIC: (
                    mapping.source_issue
                    if mapping.route == TicketRoute.DOMESTIC_TO_OVERSEAS
                    else ""
                ),
                OVERSEAS_TRUNK: target_issue,
                OSOB: target_issue,
            }
            paths: set[tuple[str, str]] = set()
            for (stage, module, issue, relative_path) in evidence:
                if issue_by_stage.get(stage) == issue:
                    paths.add((module, relative_path))
            for module, relative_path in paths:
                key = (module, relative_path.casefold())
                asset = assets.get(key)
                if asset is None:
                    asset = _AssetAccumulator(module, relative_path)
                    assets[key] = asset
                asset.source_issues.add(mapping.source_issue)
                asset.target_issues.add(target_issue)
                for stage, issue in issue_by_stage.items():
                    if not issue:
                        continue
                    branch = evidence.get(
                        (stage, module, issue, relative_path)
                    )
                    if branch is not None:
                        asset.evidence[stage] = _merge_evidence(
                            asset.evidence.get(stage),
                            branch,
                        )

        result = tuple(
            RemoteAssetProgress(
                module=item.module,
                relative_path=item.relative_path,
                display_path=_display_path(
                    item.module,
                    item.relative_path,
                ),
                source_issues=tuple(sorted(item.source_issues)),
                target_issues=tuple(sorted(item.target_issues)),
                domestic=item.evidence.get(DOMESTIC, BranchEvidence()),
                overseas_trunk=item.evidence.get(
                    OVERSEAS_TRUNK,
                    BranchEvidence(),
                ),
                osob=item.evidence.get(OSOB, BranchEvidence()),
            )
            for item in sorted(
                assets.values(),
                key=lambda value: (
                    value.module,
                    value.relative_path.casefold(),
                ),
            )
        )
        self._check_cancelled()
        final_result = RemoteAssetProgressResult(
            assets=result,
            warnings=tuple(warnings),
            query_start=start.isoformat(),
            elapsed_seconds=time.monotonic() - started,
        )
        if self.cache is not None and not warnings:
            try:
                self.cache.save(cache_key, final_result)
            except OSError:
                pass
        return final_result

    def _progress(self, stage: str, message: str) -> None:
        if self.progress is not None:
            self.progress(stage, message)

    def _cancelled(self) -> bool:
        return (
            self.cancel_event is not None
            and self.cancel_event.is_set()
        )

    def _check_cancelled(self) -> None:
        if self._cancelled():
            raise RemoteAssetScanCancelled("远端资产查询已取消")


def _collect_evidence(
    repository: RemoteRepository,
    commits: Iterable[SvnCommit],
    issue_keys: tuple[str, ...],
) -> dict[tuple[str, str, str, str], BranchEvidence]:
    collected: dict[
        tuple[str, str, str, str],
        _EvidenceAccumulator,
    ] = defaultdict(_EvidenceAccumulator)
    prefix = repository.repository_path.rstrip("/") + "/"
    for commit in commits:
        matched_issues = tuple(
            issue
            for issue in issue_keys
            if message_has_issue(commit.message, issue)
        )
        if not matched_issues:
            continue
        for change in commit.changes:
            if change.kind == "dir":
                continue
            normalized_path = "/" + change.path.replace("\\", "/").strip("/")
            if not normalized_path.casefold().startswith(prefix.casefold()):
                continue
            relative_path = normalized_path[len(prefix):]
            if not relative_path:
                continue
            for issue in matched_issues:
                key = (
                    repository.stage,
                    repository.module,
                    issue,
                    relative_path,
                )
                accumulator = collected[key]
                accumulator.revisions.add(commit.revision)
                if commit.author:
                    accumulator.authors.add(commit.author)
                accumulator.actions.append(
                    (commit.revision, change.action)
                )
    return {
        key: accumulator.freeze()
        for key, accumulator in collected.items()
    }


def _merge_evidence(
    left: BranchEvidence | None,
    right: BranchEvidence,
) -> BranchEvidence:
    if left is None:
        return right
    revisions = tuple(sorted(set(left.revisions) | set(right.revisions)))
    latest_action = (
        right.action
        if right.revisions
        and (
            not left.revisions
            or right.revisions[-1] >= left.revisions[-1]
        )
        else left.action
    )
    return BranchEvidence(
        revisions=revisions,
        authors=tuple(sorted(set(left.authors) | set(right.authors))),
        action=latest_action,
    )


def _display_path(module: str, relative_path: str) -> str:
    normalized = relative_path.replace("\\", "/").strip("/")
    if module == "res" and normalized.casefold().startswith("content/"):
        value = normalized[len("Content/"):]
        suffix = PurePosixPath(value).suffix.casefold()
        if suffix in {".uasset", ".umap"}:
            value = value[: -len(suffix)]
        return f"/res/Game/{value}"
    return f"/{module}/{normalized}"


def _result_to_dict(
    result: RemoteAssetProgressResult,
) -> dict[str, object]:
    return {
        "query_start": result.query_start,
        "warnings": list(result.warnings),
        "assets": [
            {
                "module": asset.module,
                "relative_path": asset.relative_path,
                "display_path": asset.display_path,
                "source_issues": list(asset.source_issues),
                "target_issues": list(asset.target_issues),
                "domestic": _evidence_to_dict(asset.domestic),
                "overseas_trunk": _evidence_to_dict(
                    asset.overseas_trunk
                ),
                "osob": _evidence_to_dict(asset.osob),
            }
            for asset in result.assets
        ],
    }


def _result_from_dict(value: object) -> RemoteAssetProgressResult:
    if not isinstance(value, dict):
        raise ValueError("资产缓存格式无效")
    raw_assets = value.get("assets", [])
    if not isinstance(raw_assets, list):
        raise ValueError("资产缓存缺少 assets")
    assets = []
    for raw in raw_assets:
        if not isinstance(raw, dict):
            continue
        assets.append(
            RemoteAssetProgress(
                module=str(raw.get("module", "")),
                relative_path=str(raw.get("relative_path", "")),
                display_path=str(raw.get("display_path", "")),
                source_issues=_string_tuple(raw.get("source_issues")),
                target_issues=_string_tuple(raw.get("target_issues")),
                domestic=_evidence_from_dict(raw.get("domestic")),
                overseas_trunk=_evidence_from_dict(
                    raw.get("overseas_trunk")
                ),
                osob=_evidence_from_dict(raw.get("osob")),
            )
        )
    return RemoteAssetProgressResult(
        assets=tuple(assets),
        warnings=_string_tuple(value.get("warnings")),
        query_start=str(value.get("query_start", "")),
    )


def _evidence_to_dict(evidence: BranchEvidence) -> dict[str, object]:
    return {
        "revisions": list(evidence.revisions),
        "authors": list(evidence.authors),
        "action": evidence.action,
    }


def _evidence_from_dict(value: object) -> BranchEvidence:
    if not isinstance(value, dict):
        return BranchEvidence()
    raw_revisions = value.get("revisions", [])
    revisions = (
        tuple(int(item) for item in raw_revisions)
        if isinstance(raw_revisions, list)
        else ()
    )
    return BranchEvidence(
        revisions=revisions,
        authors=_string_tuple(value.get("authors")),
        action=str(value.get("action", "")),
    )


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        return ()
    return tuple(str(item) for item in value)


def _decode_output(value: bytes) -> str:
    if not value:
        return ""
    try:
        return value.decode("utf-8-sig")
    except UnicodeDecodeError:
        encoding = "mbcs" if os.name == "nt" else "utf-8"
        return value.decode(encoding, errors="replace")
