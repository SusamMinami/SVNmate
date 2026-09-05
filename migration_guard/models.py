from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path


class VerificationState(str, Enum):
    COMPLETE = "complete"
    SUBMITTED = "submitted"
    PENDING_COMMIT = "pending_commit"
    NOT_MIGRATED = "not_migrated"
    NEEDS_UPDATE = "needs_update"
    NEEDS_REVIEW = "needs_review"
    BLOCKED = "blocked"

    @property
    def label(self) -> str:
        return {
            self.COMPLETE: "已完成",
            self.SUBMITTED: "已提交",
            self.PENDING_COMMIT: "待提交",
            self.NOT_MIGRATED: "未迁移",
            self.NEEDS_UPDATE: "需更新",
            self.NEEDS_REVIEW: "需确认",
            self.BLOCKED: "阻断",
        }[self]


@dataclass(frozen=True)
class WorkspaceModule:
    name: str
    source_path: Path
    target_path: Path


@dataclass(frozen=True)
class SvnInfo:
    path: str
    url: str
    relative_url: str
    repository_root: str
    repository_uuid: str
    revision: int
    wc_root: str
    kind: str

    @property
    def repository_path(self) -> str:
        value = self.relative_url
        if value.startswith("^"):
            value = value[1:]
        return "/" + value.strip("/")


@dataclass(frozen=True)
class SvnChange:
    action: str
    path: str
    kind: str
    copyfrom_path: str = ""
    copyfrom_revision: int | None = None


@dataclass(frozen=True)
class SvnCommit:
    revision: int
    author: str
    date: str
    message: str
    changes: tuple[SvnChange, ...]


@dataclass(frozen=True)
class WorkingCopyStatus:
    path: str
    item: str
    props: str
    revision: int | None = None
    repository_item: str = ""
    repository_props: str = ""
    error: str = ""

    @property
    def is_changed(self) -> bool:
        return self.item not in {"", "none", "normal", "external"}

    @property
    def is_blocking(self) -> bool:
        return self.item in {
            "conflicted",
            "obstructed",
            "incomplete",
            "error",
        }

    @property
    def is_out_of_date(self) -> bool:
        return self.repository_item not in {"", "none", "normal"}


@dataclass(frozen=True)
class ExpectedChange:
    module: str
    source_issue: str
    target_issue: str
    source_path: str
    source_local_path: str
    target_path: str
    target_local_path: str
    action: str
    kind: str
    source_revisions: tuple[int, ...]
    source_authors: tuple[str, ...]
    source_messages: tuple[str, ...]
    is_external: bool = False
    mapping_error: str = ""


@dataclass(frozen=True)
class FileVerification:
    expected: ExpectedChange
    state: VerificationState
    local_status: str
    repository_status: str
    target_revisions: tuple[int, ...] = field(default_factory=tuple)
    reason: str = ""

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["state"] = self.state.value
        data["state_label"] = self.state.label
        return data


@dataclass(frozen=True)
class ModuleAudit:
    module: str
    source_path: str
    target_path: str
    source_revision: int
    target_revision: int
    source_commit_count: int
    target_commit_count: int


@dataclass(frozen=True)
class MigrationAuditResult:
    source_issue: str
    target_issue: str
    started_at: str
    finished_at: str
    files: tuple[FileVerification, ...]
    modules: tuple[ModuleAudit, ...]
    warnings: tuple[str, ...] = field(default_factory=tuple)
    label: str = ""

    @property
    def counts(self) -> dict[str, int]:
        result = {state.value: 0 for state in VerificationState}
        for item in self.files:
            result[item.state.value] += 1
        return result

    @property
    def complete(self) -> bool:
        return bool(self.files) and all(
            item.state
            in {
                VerificationState.COMPLETE,
                VerificationState.SUBMITTED,
            }
            for item in self.files
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "source_issue": self.source_issue,
            "target_issue": self.target_issue,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "complete": self.complete,
            "counts": self.counts,
            "files": [item.to_dict() for item in self.files],
            "modules": [asdict(item) for item in self.modules],
            "warnings": list(self.warnings),
            "label": self.label,
        }


@dataclass(frozen=True)
class MigrationCase:
    source_issue: str
    target_issue: str
    label: str = ""


@dataclass(frozen=True)
class BatchMigrationAuditResult:
    started_at: str
    finished_at: str
    cases: tuple[MigrationAuditResult, ...]
    warnings: tuple[str, ...] = field(default_factory=tuple)

    @property
    def files(self) -> tuple[FileVerification, ...]:
        return tuple(
            item
            for case in self.cases
            for item in case.files
        )

    @property
    def modules(self) -> tuple[ModuleAudit, ...]:
        if not self.cases:
            return ()
        return self.cases[0].modules

    @property
    def source_issue(self) -> str:
        return ",".join(case.source_issue for case in self.cases)

    @property
    def target_issue(self) -> str:
        return ",".join(case.target_issue for case in self.cases)

    @property
    def counts(self) -> dict[str, int]:
        result = {state.value: 0 for state in VerificationState}
        for item in self.files:
            result[item.state.value] += 1
        return result

    @property
    def complete(self) -> bool:
        return bool(self.cases) and all(case.complete for case in self.cases)

    def to_dict(self) -> dict[str, object]:
        return {
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "complete": self.complete,
            "counts": self.counts,
            "cases": [case.to_dict() for case in self.cases],
            "warnings": list(self.warnings),
        }
