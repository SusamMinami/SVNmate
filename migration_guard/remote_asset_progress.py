from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import PurePosixPath

from .models import SvnCommit
from .svn_client import SvnClient, message_has_issue
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


class RemoteAssetProgressService:
    def __init__(
        self,
        svn: SvnClient | None = None,
        *,
        repositories: Iterable[RemoteRepository] = (
            DEFAULT_REMOTE_REPOSITORIES
        ),
        progress: ProgressSink | None = None,
    ) -> None:
        self.svn = svn or SvnClient()
        self.repositories = tuple(repositories)
        self.progress = progress

    def scan(
        self,
        mappings: Iterable[TicketMapping],
        *,
        enabled_modules: Iterable[str] = ("res", "doc", "bin"),
        lookback_days: int = 90,
    ) -> RemoteAssetProgressResult:
        mapping_list = tuple(mappings)
        modules = tuple(dict.fromkeys(enabled_modules))
        if not mapping_list:
            return RemoteAssetProgressResult(())
        if lookback_days < 1 or lookback_days > 3650:
            raise ValueError("查询天数必须在 1 到 3650 之间")

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
        start = date.today() - timedelta(days=lookback_days)
        evidence: dict[
            tuple[str, str, str, str],
            BranchEvidence,
        ] = {}
        warnings: list[str] = []

        def query(
            repository: RemoteRepository,
        ) -> tuple[RemoteRepository, tuple[SvnCommit, ...]]:
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
        return RemoteAssetProgressResult(
            assets=result,
            warnings=tuple(warnings),
        )

    def _progress(self, stage: str, message: str) -> None:
        if self.progress is not None:
            self.progress(stage, message)


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
