from __future__ import annotations

import os
from collections import defaultdict
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .models import (
    BatchMigrationAuditResult,
    ExpectedChange,
    FileVerification,
    MigrationCase,
    MigrationAuditResult,
    ModuleAudit,
    SvnChange,
    SvnCommit,
    SvnInfo,
    VerificationState,
    WorkingCopyStatus,
    WorkspaceModule,
)
from .svn_client import (
    SvnClient,
    issue_keys_in_message,
    message_has_issue,
    normalize_issue_key,
)


ProgressSink = Callable[[str, str], None]


@dataclass(frozen=True)
class _WorkingCopyContext:
    module: str
    module_root: Path
    local_root: Path
    relative_local_root: str
    info: SvnInfo
    is_external: bool


@dataclass
class _ExpectedAccumulator:
    context: _WorkingCopyContext
    change: SvnChange
    revisions: set[int] = field(default_factory=set)
    authors: set[str] = field(default_factory=set)
    messages: set[str] = field(default_factory=set)
    actions: list[tuple[int, str]] = field(default_factory=list)


class MigrationAuditService:
    def __init__(
        self,
        svn: SvnClient | None = None,
        *,
        progress: ProgressSink | None = None,
        include_externals: bool = True,
    ) -> None:
        self.svn = svn or SvnClient()
        self.progress = progress
        self.include_externals = include_externals

    def audit(
        self,
        modules: Iterable[WorkspaceModule],
        source_issue: str,
        target_issue: str,
        *,
        lookback_days: int = 90,
    ) -> MigrationAuditResult:
        started_at = _utc_now()
        source_key = normalize_issue_key(source_issue)
        target_key = normalize_issue_key(target_issue)
        if lookback_days < 1 or lookback_days > 3650:
            raise ValueError("查询天数必须在 1 到 3650 之间")
        start_date = date.today() - timedelta(days=lookback_days)
        module_list = tuple(modules)
        if not module_list:
            raise ValueError("至少需要一个工作区模块")

        source_contexts: dict[str, tuple[_WorkingCopyContext, ...]] = {}
        target_contexts: dict[str, tuple[_WorkingCopyContext, ...]] = {}
        module_audits: list[ModuleAudit] = []

        for module in module_list:
            self._progress("workspace", f"检查 {module.name} 工作副本")
            source = self._contexts_for_module(
                module.name,
                module.source_path,
            )
            target = self._contexts_for_module(
                module.name,
                module.target_path,
            )
            if source[0].info.repository_uuid != target[0].info.repository_uuid:
                raise ValueError(
                    f"{module.name} 的源和目标不属于同一 SVN 仓库"
                )
            _validate_workspace_roles(
                module.name,
                source[0].info,
                target[0].info,
            )
            source_contexts[module.name] = source
            target_contexts[module.name] = target
            module_audits.append(
                ModuleAudit(
                    module=module.name,
                    source_path=str(module.source_path),
                    target_path=str(module.target_path),
                    source_revision=source[0].info.revision,
                    target_revision=target[0].info.revision,
                    source_commit_count=0,
                    target_commit_count=0,
                )
            )

        accumulators: dict[
            tuple[str, str],
            _ExpectedAccumulator,
        ] = {}
        source_commit_revisions: dict[str, set[int]] = defaultdict(set)
        ordered_source_contexts = _base_contexts_first(source_contexts)
        for context in ordered_source_contexts:
            self._progress(
                "source-log",
                f"扫描 {context.module}：{context.relative_local_root}",
            )
            commits = self.svn.log_by_issue(
                context.local_root,
                source_key,
                start=start_date,
            )
            for commit in commits:
                source_commit_revisions[context.module].add(commit.revision)
                self._collect_source_changes(
                    context,
                    commit,
                    accumulators,
                )

        expected = self._build_expected_changes(
            accumulators,
            target_contexts,
            source_issue=source_key,
            target_issue=target_key,
        )
        if not expected:
            return MigrationAuditResult(
                source_issue=source_key,
                target_issue=target_key,
                started_at=started_at,
                finished_at=_utc_now(),
                files=(),
                modules=tuple(module_audits),
                warnings=(
                    f"查询范围内未找到 {source_key} 的文件提交",
                ),
            )

        target_commits_by_path: dict[
            tuple[str, str],
            list[SvnCommit],
        ] = defaultdict(list)
        target_commit_revisions: dict[str, set[int]] = defaultdict(set)
        for context in self._target_contexts_for_expected(
            expected,
            target_contexts,
        ):
            self._progress(
                "target-log",
                f"检查 {context.module} 提交：{context.relative_local_root}",
            )
            commits = self.svn.log_by_issue(
                context.local_root,
                target_key,
                start=start_date,
            )
            for commit in commits:
                target_commit_revisions[context.module].add(commit.revision)
                for change in commit.changes:
                    target_commits_by_path[
                        _repository_path_key(
                            context.info.repository_uuid,
                            change.path,
                        )
                    ].append(commit)

        target_paths = [
            item.target_local_path
            for item in expected
            if item.target_local_path and not item.mapping_error
        ]
        self._progress(
            "target-status",
            f"检查 {len(target_paths)} 个目标文件",
        )
        statuses = self.svn.status_paths(target_paths, show_updates=True)
        verified = tuple(
            self._verify_file(
                item,
                statuses,
                target_commits_by_path,
                target_contexts,
            )
            for item in expected
        )

        updated_module_audits = tuple(
            ModuleAudit(
                module=item.module,
                source_path=item.source_path,
                target_path=item.target_path,
                source_revision=item.source_revision,
                target_revision=item.target_revision,
                source_commit_count=len(source_commit_revisions[item.module]),
                target_commit_count=len(target_commit_revisions[item.module]),
            )
            for item in module_audits
        )
        return MigrationAuditResult(
            source_issue=source_key,
            target_issue=target_key,
            started_at=started_at,
            finished_at=_utc_now(),
            files=verified,
            modules=updated_module_audits,
        )

    def audit_batch(
        self,
        modules: Iterable[WorkspaceModule],
        cases: Iterable[MigrationCase],
        *,
        lookback_days: int = 90,
    ) -> BatchMigrationAuditResult:
        started_at = _utc_now()
        if lookback_days < 1 or lookback_days > 3650:
            raise ValueError("查询天数必须在 1 到 3650 之间")
        module_list = tuple(modules)
        if not module_list:
            raise ValueError("至少需要一个工作区模块")
        normalized_cases = tuple(
            dict.fromkeys(
                (
                    normalize_issue_key(case.source_issue),
                    normalize_issue_key(case.target_issue),
                    case.label,
                )
                for case in cases
            )
        )
        case_list = tuple(
            MigrationCase(source, target, label)
            for source, target, label in normalized_cases
        )
        if not case_list:
            raise ValueError("至少需要一个迁移任务")

        source_contexts: dict[str, tuple[_WorkingCopyContext, ...]] = {}
        target_contexts: dict[str, tuple[_WorkingCopyContext, ...]] = {}
        module_templates: dict[str, ModuleAudit] = {}
        for module in module_list:
            self._progress("workspace", f"检查 {module.name} 工作副本")
            source = self._contexts_for_module(
                module.name,
                module.source_path,
            )
            target = self._contexts_for_module(
                module.name,
                module.target_path,
            )
            if source[0].info.repository_uuid != target[0].info.repository_uuid:
                raise ValueError(
                    f"{module.name} 的源和目标不属于同一 SVN 仓库"
                )
            _validate_workspace_roles(
                module.name,
                source[0].info,
                target[0].info,
            )
            source_contexts[module.name] = source
            target_contexts[module.name] = target
            module_templates[module.name] = ModuleAudit(
                module=module.name,
                source_path=str(module.source_path),
                target_path=str(module.target_path),
                source_revision=source[0].info.revision,
                target_revision=target[0].info.revision,
                source_commit_count=0,
                target_commit_count=0,
            )

        source_keys = tuple(case.source_issue for case in case_list)
        start_date = date.today() - timedelta(days=lookback_days)
        source_logs = self._batch_logs(
            _base_contexts_first(source_contexts),
            source_keys,
            start=start_date,
            stage="source-log",
            verb="扫描",
        )

        expected_by_case: dict[
            MigrationCase,
            tuple[ExpectedChange, ...],
        ] = {}
        source_revisions_by_case: dict[
            MigrationCase,
            dict[str, set[int]],
        ] = {}
        all_expected: list[ExpectedChange] = []
        for case in case_list:
            accumulators: dict[
                tuple[str, str],
                _ExpectedAccumulator,
            ] = {}
            module_revisions: dict[str, set[int]] = defaultdict(set)
            for context, commits in source_logs.items():
                for commit in commits:
                    if not message_has_issue(
                        commit.message,
                        case.source_issue,
                    ):
                        continue
                    module_revisions[context.module].add(commit.revision)
                    self._collect_source_changes(
                        context,
                        commit,
                        accumulators,
                    )
            expected = self._build_expected_changes(
                accumulators,
                target_contexts,
                source_issue=case.source_issue,
                target_issue=case.target_issue,
            )
            expected_by_case[case] = expected
            source_revisions_by_case[case] = module_revisions
            all_expected.extend(expected)

        required_target_contexts = self._target_contexts_for_expected(
            tuple(all_expected),
            target_contexts,
        )
        target_keys = tuple(case.target_issue for case in case_list)
        target_logs = self._batch_logs(
            required_target_contexts,
            target_keys,
            start=start_date,
            stage="target-log",
            verb="检查",
            message_pattern="*OSCOA-*",
        )

        unique_target_paths = tuple(
            dict.fromkeys(
                item.target_local_path
                for item in all_expected
                if item.target_local_path and not item.mapping_error
            )
        )
        self._progress(
            "target-status",
            f"统一检查 {len(unique_target_paths)} 个目标文件",
        )
        statuses = self.svn.status_paths(
            unique_target_paths,
            show_updates=True,
        )
        batch_target_commits_by_path: dict[
            tuple[str, str],
            list[SvnCommit],
        ] = defaultdict(list)
        batch_target_issues_by_path: dict[
            tuple[str, str],
            set[str],
        ] = defaultdict(set)
        for context, commits in target_logs.items():
            for commit in commits:
                matched_issues = tuple(
                    issue
                    for issue in issue_keys_in_message(commit.message)
                    if issue.startswith("OSCOA-")
                )
                if not matched_issues:
                    continue
                for change in commit.changes:
                    key = _repository_path_key(
                        context.info.repository_uuid,
                        change.path,
                    )
                    batch_target_commits_by_path[key].append(commit)
                    batch_target_issues_by_path[key].update(
                        matched_issues
                    )

        results: list[MigrationAuditResult] = []
        for case in case_list:
            target_commits_by_path: dict[
                tuple[str, str],
                list[SvnCommit],
            ] = defaultdict(list)
            target_revisions: dict[str, set[int]] = defaultdict(set)
            for context, commits in target_logs.items():
                for commit in commits:
                    if not message_has_issue(
                        commit.message,
                        case.target_issue,
                    ):
                        continue
                    target_revisions[context.module].add(commit.revision)
                    for change in commit.changes:
                        target_commits_by_path[
                            _repository_path_key(
                                context.info.repository_uuid,
                                change.path,
                            )
                        ].append(commit)

            expected = expected_by_case[case]
            verified = tuple(
                self._verify_file(
                    item,
                    statuses,
                    target_commits_by_path,
                    target_contexts,
                    alternate_target_commits_by_path=(
                        batch_target_commits_by_path
                    ),
                    alternate_target_issues_by_path=(
                        batch_target_issues_by_path
                    ),
                )
                for item in expected
            )
            module_audits = tuple(
                ModuleAudit(
                    module=template.module,
                    source_path=template.source_path,
                    target_path=template.target_path,
                    source_revision=template.source_revision,
                    target_revision=template.target_revision,
                    source_commit_count=len(
                        source_revisions_by_case[case][template.module]
                    ),
                    target_commit_count=len(
                        target_revisions[template.module]
                    ),
                )
                for template in module_templates.values()
            )
            warnings = ()
            if not expected:
                warnings = (
                    f"查询范围内未找到 {case.source_issue} 的文件提交",
                )
            results.append(
                MigrationAuditResult(
                    source_issue=case.source_issue,
                    target_issue=case.target_issue,
                    started_at=started_at,
                    finished_at=_utc_now(),
                    files=verified,
                    modules=module_audits,
                    warnings=warnings,
                    label=case.label,
                )
            )
        return BatchMigrationAuditResult(
            started_at=started_at,
            finished_at=_utc_now(),
            cases=tuple(results),
        )

    def _batch_logs(
        self,
        contexts: Iterable[_WorkingCopyContext],
        issue_keys: tuple[str, ...],
        *,
        start: date,
        stage: str,
        verb: str,
        message_pattern: str = "",
    ) -> dict[_WorkingCopyContext, tuple[SvnCommit, ...]]:
        context_list = tuple(contexts)
        if not context_list:
            return {}

        def scan(
            context: _WorkingCopyContext,
        ) -> tuple[_WorkingCopyContext, tuple[SvnCommit, ...]]:
            self._progress(
                stage,
                f"批量{verb} {context.module}："
                f"{context.relative_local_root}（{len(issue_keys)} 单）",
            )
            return (
                context,
                (
                    self.svn.log_by_message_pattern(
                        context.local_root,
                        message_pattern,
                        start=start,
                    )
                    if message_pattern
                    else self.svn.log_by_issues(
                        context.local_root,
                        issue_keys,
                        start=start,
                    )
                ),
            )

        results: dict[
            _WorkingCopyContext,
            tuple[SvnCommit, ...],
        ] = {}
        worker_count = min(4, len(context_list))
        with ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="migration-svn-log",
        ) as executor:
            futures = {
                executor.submit(scan, context): context
                for context in context_list
            }
            for future in as_completed(futures):
                context, commits = future.result()
                results[context] = commits
        return results

    def _contexts_for_module(
        self,
        module: str,
        root: Path,
    ) -> tuple[_WorkingCopyContext, ...]:
        root = Path(root)
        base_info = self.svn.info(root)
        contexts = [
            _WorkingCopyContext(
                module=module,
                module_root=root,
                local_root=root,
                relative_local_root=".",
                info=base_info,
                is_external=False,
            )
        ]
        if not self.include_externals:
            return tuple(contexts)
        for external_path in self.svn.external_paths(root):
            try:
                external_info = self.svn.info(external_path)
            except Exception as exc:
                self._progress(
                    "warning",
                    f"无法读取 external {external_path}：{exc}",
                )
                continue
            contexts.append(
                _WorkingCopyContext(
                    module=module,
                    module_root=root,
                    local_root=external_path,
                    relative_local_root=_relative_local_path(
                        external_path,
                        root,
                    ),
                    info=external_info,
                    is_external=True,
                )
            )
        return tuple(contexts)

    def _collect_source_changes(
        self,
        context: _WorkingCopyContext,
        commit: SvnCommit,
        accumulators: dict[tuple[str, str], _ExpectedAccumulator],
    ) -> None:
        for change in commit.changes:
            if change.kind == "dir":
                continue
            suffix = _repository_suffix(
                context.info.repository_path,
                change.path,
            )
            if suffix is None:
                continue
            identity = _repository_path_key(
                context.info.repository_uuid,
                change.path,
            )
            current = accumulators.get(identity)
            if current is None:
                current = _ExpectedAccumulator(
                    context=context,
                    change=change,
                )
                accumulators[identity] = current
            elif current.context.is_external and not context.is_external:
                current.context = context
            current.change = change
            current.revisions.add(commit.revision)
            if commit.author:
                current.authors.add(commit.author)
            if commit.message:
                current.messages.add(commit.message)
            current.actions.append((commit.revision, change.action))

    def _build_expected_changes(
        self,
        accumulators: dict[tuple[str, str], _ExpectedAccumulator],
        target_contexts: dict[str, tuple[_WorkingCopyContext, ...]],
        *,
        source_issue: str,
        target_issue: str,
    ) -> tuple[ExpectedChange, ...]:
        expected = []
        for accumulator in accumulators.values():
            source_context = accumulator.context
            suffix = _repository_suffix(
                source_context.info.repository_path,
                accumulator.change.path,
            )
            if suffix is None:
                continue
            target_context = _matching_target_context(
                source_context,
                target_contexts.get(source_context.module, ()),
            )
            source_local = _join_context_path(
                source_context.local_root,
                suffix,
            )
            display_relative = _relative_local_path(
                source_local,
                source_context.module_root,
            )
            mapping_error = ""
            target_path = ""
            target_local_path = ""
            if target_context is None:
                mapping_error = (
                    "目标工作区缺少对应的 SVN external"
                    if source_context.is_external
                    else "目标工作区缺少对应模块"
                )
            elif (
                source_context.info.repository_uuid
                != target_context.info.repository_uuid
            ):
                mapping_error = "源和目标路径不属于同一 SVN 仓库"
            else:
                target_path = _join_repository_path(
                    target_context.info.repository_path,
                    suffix,
                )
                target_local_path = str(
                    _join_context_path(target_context.local_root, suffix)
                )

            actions = sorted(accumulator.actions)
            expected.append(
                ExpectedChange(
                    module=source_context.module,
                    source_issue=source_issue,
                    target_issue=target_issue,
                    source_path=accumulator.change.path,
                    source_local_path=str(source_local),
                    target_path=target_path,
                    target_local_path=target_local_path,
                    action=actions[-1][1] if actions else "",
                    kind=accumulator.change.kind,
                    source_revisions=tuple(sorted(accumulator.revisions)),
                    source_authors=tuple(sorted(accumulator.authors)),
                    source_messages=tuple(sorted(accumulator.messages)),
                    is_external=source_context.is_external,
                    mapping_error=mapping_error,
                )
            )
        return tuple(
            sorted(
                expected,
                key=lambda item: (
                    item.module.casefold(),
                    _path_key(item.target_local_path or item.source_local_path),
                ),
            )
        )

    def _target_contexts_for_expected(
        self,
        expected: tuple[ExpectedChange, ...],
        target_contexts: dict[str, tuple[_WorkingCopyContext, ...]],
    ) -> tuple[_WorkingCopyContext, ...]:
        contexts = []
        seen: set[tuple[str, str]] = set()
        for item in expected:
            if item.mapping_error:
                continue
            for context in target_contexts.get(item.module, ()):
                if not _repository_suffix(
                    context.info.repository_path,
                    item.target_path,
                ) is None:
                    key = (
                        context.info.repository_uuid.casefold(),
                        context.info.repository_path.casefold(),
                    )
                    if key not in seen:
                        seen.add(key)
                        contexts.append(context)
                    break
        return tuple(contexts)

    def _verify_file(
        self,
        expected: ExpectedChange,
        statuses: dict[str, WorkingCopyStatus],
        target_commits_by_path: dict[
            tuple[str, str],
            list[SvnCommit],
        ],
        target_contexts: dict[str, tuple[_WorkingCopyContext, ...]],
        *,
        alternate_target_commits_by_path: dict[
            tuple[str, str],
            list[SvnCommit],
        ]
        | None = None,
        alternate_target_issues_by_path: dict[
            tuple[str, str],
            set[str],
        ]
        | None = None,
    ) -> FileVerification:
        if expected.mapping_error:
            return FileVerification(
                expected=expected,
                state=VerificationState.BLOCKED,
                local_status="unknown",
                repository_status="unknown",
                reason=expected.mapping_error,
            )

        target_context = _context_for_repository_path(
            expected.target_path,
            target_contexts.get(expected.module, ()),
        )
        if target_context is None:
            return FileVerification(
                expected=expected,
                state=VerificationState.BLOCKED,
                local_status="unknown",
                repository_status="unknown",
                reason="无法定位目标 SVN 工作副本",
            )

        status = _status_for_path(statuses, expected.target_local_path)
        local_status = status.item if status is not None else "normal"
        repository_status = (
            status.repository_item if status is not None else ""
        )
        repository_key = _repository_path_key(
            target_context.info.repository_uuid,
            expected.target_path,
        )
        target_commits = target_commits_by_path.get(repository_key, [])
        submitted_by_other = False
        alternate_issues: tuple[str, ...] = ()
        if not target_commits and alternate_target_commits_by_path:
            target_commits = alternate_target_commits_by_path.get(
                repository_key,
                [],
            )
            submitted_by_other = bool(target_commits)
            if submitted_by_other and alternate_target_issues_by_path:
                alternate_issues = tuple(
                    sorted(
                        alternate_target_issues_by_path.get(
                            repository_key,
                            set(),
                        )
                    )
                )
        target_revisions = tuple(
            sorted({commit.revision for commit in target_commits})
        )
        target_actions = [
            (commit.revision, change.action)
            for commit in target_commits
            for change in commit.changes
            if _normalize_repository_path(change.path)
            == _normalize_repository_path(expected.target_path)
        ]
        target_final_action = (
            max(target_actions)[1] if target_actions else ""
        )
        target_exists = Path(expected.target_local_path).exists()

        if status is not None and status.is_blocking:
            if status.item == "error" and not target_exists:
                status = None
                local_status = "absent"
            else:
                return FileVerification(
                    expected=expected,
                    state=VerificationState.BLOCKED,
                    local_status=local_status,
                    repository_status=repository_status,
                    target_revisions=target_revisions,
                    reason=status.error or "目标工作副本存在阻断状态",
                )

        if status is not None and status.is_out_of_date:
            return FileVerification(
                expected=expected,
                state=VerificationState.NEEDS_UPDATE,
                local_status=local_status,
                repository_status=repository_status,
                target_revisions=target_revisions,
                reason="目标工作副本不是仓库最新状态",
            )

        if status is not None and status.is_changed:
            return FileVerification(
                expected=expected,
                state=VerificationState.PENDING_COMMIT,
                local_status=local_status,
                repository_status=repository_status,
                target_revisions=target_revisions,
                reason="目标文件存在尚未提交的本地改动",
            )

        if target_revisions:
            expected_delete = expected.action == "D"
            committed_delete = target_final_action == "D"
            if expected_delete != committed_delete:
                return FileVerification(
                    expected=expected,
                    state=VerificationState.NEEDS_REVIEW,
                    local_status=local_status,
                    repository_status=repository_status,
                    target_revisions=target_revisions,
                    reason="目标提交动作与源最终动作不一致",
                )
            if expected_delete and target_exists:
                return FileVerification(
                    expected=expected,
                    state=VerificationState.NEEDS_REVIEW,
                    local_status=local_status,
                    repository_status=repository_status,
                    target_revisions=target_revisions,
                    reason="目标已提交删除，但当前工作副本中仍存在该文件",
                )
            if not expected_delete and not target_exists:
                return FileVerification(
                    expected=expected,
                    state=VerificationState.NEEDS_REVIEW,
                    local_status="absent",
                    repository_status=repository_status,
                    target_revisions=target_revisions,
                    reason="目标提交曾覆盖该路径，但当前文件不存在",
                )
            return FileVerification(
                expected=expected,
                state=(
                    VerificationState.SUBMITTED
                    if submitted_by_other
                    else VerificationState.COMPLETE
                ),
                local_status="absent" if not target_exists else local_status,
                repository_status=repository_status,
                target_revisions=target_revisions,
                reason=(
                    "已由其他海外单号提交："
                    + "、".join(alternate_issues)
                    if submitted_by_other and alternate_issues
                    else (
                        "已由本批次其他海外单号提交"
                        if submitted_by_other
                        else "海外单号提交已覆盖该路径"
                    )
                ),
            )

        if expected.action == "D" and not target_exists:
            return FileVerification(
                expected=expected,
                state=VerificationState.NEEDS_REVIEW,
                local_status="absent",
                repository_status=repository_status,
                reason="目标文件不存在，但没有海外单号删除证据",
            )
        return FileVerification(
            expected=expected,
            state=VerificationState.NOT_MIGRATED,
            local_status=local_status if target_exists else "absent",
            repository_status=repository_status,
            reason=(
                "目标文件存在但没有本地改动或海外提交证据"
                if target_exists
                else "目标文件不存在且没有海外提交证据"
            ),
        )

    def _progress(self, stage: str, message: str) -> None:
        if self.progress is not None:
            self.progress(stage, message)


def default_workspace_modules(
    source_root: Path | str,
    target_root: Path | str,
    enabled_modules: Iterable[str] = ("res", "doc", "bin"),
) -> tuple[WorkspaceModule, ...]:
    source = Path(source_root)
    target = Path(target_root)
    return tuple(
        WorkspaceModule(
            name=name,
            source_path=source / name,
            target_path=target / name,
        )
        for name in enabled_modules
    )


def _base_contexts_first(
    contexts: dict[str, tuple[_WorkingCopyContext, ...]],
) -> tuple[_WorkingCopyContext, ...]:
    all_contexts = [
        context
        for module_contexts in contexts.values()
        for context in module_contexts
    ]
    return tuple(
        sorted(
            all_contexts,
            key=lambda item: (
                item.is_external,
                item.module.casefold(),
                item.relative_local_root.casefold(),
            ),
        )
    )


def _matching_target_context(
    source: _WorkingCopyContext,
    targets: tuple[_WorkingCopyContext, ...],
) -> _WorkingCopyContext | None:
    expected_relative = source.relative_local_root.casefold()
    for target in targets:
        if target.relative_local_root.casefold() == expected_relative:
            return target
    return None


def _context_for_repository_path(
    repository_path: str,
    contexts: tuple[_WorkingCopyContext, ...],
) -> _WorkingCopyContext | None:
    matches = [
        context
        for context in contexts
        if _repository_suffix(
            context.info.repository_path,
            repository_path,
        )
        is not None
    ]
    if not matches:
        return None
    return max(matches, key=lambda item: len(item.info.repository_path))


def _repository_suffix(root: str, path: str) -> str | None:
    normalized_root = _normalize_repository_path(root)
    normalized_path = _normalize_repository_path(path)
    if normalized_path == normalized_root:
        return ""
    prefix = normalized_root.rstrip("/") + "/"
    if not normalized_path.startswith(prefix):
        return None
    return normalized_path[len(prefix):]


def _join_repository_path(root: str, suffix: str) -> str:
    normalized_root = _normalize_repository_path(root)
    if not suffix:
        return normalized_root
    return normalized_root.rstrip("/") + "/" + suffix.replace("\\", "/")


def _normalize_repository_path(path: str) -> str:
    return "/" + path.replace("\\", "/").strip("/")


def _repository_path_key(repository_uuid: str, path: str) -> tuple[str, str]:
    return (
        repository_uuid.casefold(),
        _normalize_repository_path(path).casefold(),
    )


def _join_context_path(root: Path, suffix: str) -> Path:
    if not suffix:
        return root
    return root.joinpath(*suffix.replace("\\", "/").split("/"))


def _relative_local_path(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except (OSError, ValueError):
        return os.path.relpath(path, root)


def _path_key(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


def _status_for_path(
    statuses: dict[str, WorkingCopyStatus],
    path: Path | str,
) -> WorkingCopyStatus | None:
    expected_key = _path_key(path)
    direct = statuses.get(expected_key)
    if direct is not None:
        return direct
    candidates = [
        status
        for key, status in statuses.items()
        if expected_key.startswith(key.rstrip("\\/") + os.sep)
        and status.item == "unversioned"
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: len(item.path))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_workspace_roles(
    module: str,
    source: SvnInfo,
    target: SvnInfo,
) -> None:
    source_path = _normalize_repository_path(source.repository_path).casefold()
    target_path = _normalize_repository_path(target.repository_path).casefold()
    if source_path == target_path:
        raise ValueError(f"{module} 的源和目标指向同一 SVN 路径")
    source_is_overseas = "/overseas/" in source_path
    target_is_overseas = "/overseas/" in target_path
    if source_is_overseas and not target_is_overseas:
        raise ValueError(f"{module} 的源和海外目标可能配置反向")
    if not target_is_overseas:
        raise ValueError(f"{module} 的目标不是 overseas 分支")
