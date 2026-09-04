from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .models import (
    BatchMigrationAuditResult,
    VerificationState,
    WorkingCopyStatus,
    WorkspaceModule,
)
from .svn_client import SvnClient


@dataclass(frozen=True)
class SelectiveUpdatePlan:
    targets: tuple[Path, ...]
    source_path_count: int
    stale_source_count: int
    stale_target_count: int
    fallback_count: int

    @property
    def empty(self) -> bool:
        return not self.targets


class SelectiveUpdatePlanner:
    def __init__(
        self,
        svn: SvnClient,
        *,
        max_targets: int = 64,
    ) -> None:
        self.svn = svn
        self.max_targets = max_targets

    def build(
        self,
        result: BatchMigrationAuditResult,
        modules: tuple[WorkspaceModule, ...],
    ) -> SelectiveUpdatePlan:
        source_paths = tuple(
            dict.fromkeys(
                item.expected.source_local_path
                for item in result.files
                if item.expected.source_local_path
            )
        )
        source_statuses = self.svn.status_paths(
            source_paths,
            show_updates=True,
        )
        module_by_name = {
            module.name.casefold(): module
            for module in modules
        }
        targets: list[Path] = []
        stale_source_count = 0
        fallback_count = 0

        source_items = {
            _path_key(item.expected.source_local_path): item
            for item in result.files
            if item.expected.source_local_path
        }
        for source_key, item in source_items.items():
            expected = item.expected
            source_path = Path(expected.source_local_path)
            source_status = source_statuses.get(source_key)
            needs_update = (
                source_status is not None
                and source_status.is_out_of_date
            )
            needs_fallback = (
                source_status is None
                or source_status.item == "error"
            )
            if not needs_update and not needs_fallback:
                continue
            module = module_by_name.get(expected.module.casefold())
            if module is None:
                continue
            target = _nearest_update_directory(
                source_path,
                module.source_path,
            )
            targets.append(target)
            stale_source_count += 1
            fallback_count += int(needs_fallback)

        stale_target_count = 0
        for item in result.files:
            if item.state != VerificationState.NEEDS_UPDATE:
                continue
            expected = item.expected
            if not expected.target_local_path:
                continue
            module = module_by_name.get(expected.module.casefold())
            if module is None:
                continue
            targets.append(
                _nearest_update_directory(
                    Path(expected.target_local_path),
                    module.target_path,
                )
            )
            stale_target_count += 1

        collapsed = _collapse_directories(targets)
        if len(collapsed) > self.max_targets:
            collapsed = _collapse_directories(
                [
                    module.source_path
                    for module in modules
                    if any(
                        _is_within(target, module.source_path)
                        for target in collapsed
                    )
                ]
                + [
                    module.target_path
                    for module in modules
                    if any(
                        _is_within(target, module.target_path)
                        for target in collapsed
                    )
                ]
            )
            fallback_count += len(collapsed)

        return SelectiveUpdatePlan(
            targets=collapsed,
            source_path_count=len(source_paths),
            stale_source_count=stale_source_count,
            stale_target_count=stale_target_count,
            fallback_count=fallback_count,
        )


def _nearest_update_directory(path: Path, boundary: Path) -> Path:
    boundary = boundary.resolve()
    candidate = path if path.is_dir() else path.parent
    while not candidate.exists() and candidate != boundary:
        candidate = candidate.parent
    try:
        candidate.resolve().relative_to(boundary)
    except (OSError, ValueError):
        return boundary
    return candidate


def _collapse_directories(
    paths: list[Path],
) -> tuple[Path, ...]:
    ordered = sorted(
        {
            Path(path)
            for path in paths
        },
        key=lambda item: (len(item.parts), _path_key(item)),
    )
    result: list[Path] = []
    for path in ordered:
        if any(_is_within(path, parent) for parent in result):
            continue
        result.append(path)
    return tuple(result)


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except (OSError, ValueError):
        return False


def _path_key(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path)))
