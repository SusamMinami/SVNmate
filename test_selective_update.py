import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from migration_guard.models import (
    BatchMigrationAuditResult,
    ExpectedChange,
    FileVerification,
    MigrationAuditResult,
    VerificationState,
    WorkingCopyStatus,
    WorkspaceModule,
)
from migration_guard.selective_update import SelectiveUpdatePlanner
from migration_guard.svn_client import SvnClient


def _key(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


class _StatusSvn:
    def __init__(
        self,
        statuses: dict[str, WorkingCopyStatus],
    ) -> None:
        self.statuses = statuses
        self.calls: list[tuple[tuple[str, ...], bool]] = []

    def status_paths(self, paths, *, show_updates):
        normalized = tuple(str(path) for path in paths)
        self.calls.append((normalized, show_updates))
        return self.statuses


def _verification(
    module: WorkspaceModule,
    relative: str,
    *,
    state: VerificationState = VerificationState.NOT_MIGRATED,
) -> FileVerification:
    source = module.source_path / relative
    target = module.target_path / relative
    return FileVerification(
        expected=ExpectedChange(
            module=module.name,
            source_issue="SERIA-10",
            target_issue="OSCOA-20",
            source_path=f"/source/{relative}",
            source_local_path=str(source),
            target_path=f"/target/{relative}",
            target_local_path=str(target),
            action="M",
            kind="file",
            source_revisions=(10,),
            source_authors=("author",),
            source_messages=("message",),
        ),
        state=state,
        local_status="normal",
        repository_status="",
    )


def _batch(*files: FileVerification) -> BatchMigrationAuditResult:
    return BatchMigrationAuditResult(
        started_at="start",
        finished_at="finish",
        cases=(
            MigrationAuditResult(
                source_issue="SERIA-10",
                target_issue="OSCOA-20",
                started_at="start",
                finished_at="finish",
                files=tuple(files),
                modules=(),
            ),
        ),
    )


class SelectiveUpdatePlannerTests(unittest.TestCase):
    def test_only_stale_source_directories_are_selected_and_collapsed(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = WorkspaceModule(
                "res",
                root / "source",
                root / "target",
            )
            stale_a = _verification(module, "Content/Game/A.uasset")
            stale_b = _verification(module, "Content/Game/B.uasset")
            current = _verification(module, "Content/UI/C.uasset")
            for item in (stale_a, stale_b, current):
                Path(item.expected.source_local_path).parent.mkdir(
                    parents=True,
                    exist_ok=True,
                )
                Path(item.expected.source_local_path).write_bytes(b"x")
            statuses = {
                _key(stale_a.expected.source_local_path): WorkingCopyStatus(
                    path=stale_a.expected.source_local_path,
                    item="normal",
                    props="none",
                    repository_item="modified",
                ),
                _key(stale_b.expected.source_local_path): WorkingCopyStatus(
                    path=stale_b.expected.source_local_path,
                    item="normal",
                    props="none",
                    repository_item="modified",
                ),
                _key(current.expected.source_local_path): WorkingCopyStatus(
                    path=current.expected.source_local_path,
                    item="normal",
                    props="none",
                ),
            }

            plan = SelectiveUpdatePlanner(_StatusSvn(statuses)).build(
                _batch(stale_a, stale_b, current),
                (module,),
            )

        self.assertEqual(
            plan.targets,
            (module.source_path / "Content" / "Game",),
        )
        self.assertEqual(plan.source_path_count, 3)
        self.assertEqual(plan.stale_source_count, 2)
        self.assertEqual(plan.stale_target_count, 0)

    def test_missing_source_and_stale_target_use_existing_parents(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = WorkspaceModule(
                "res",
                root / "source",
                root / "target",
            )
            item = _verification(
                module,
                "Content/New/A.uasset",
                state=VerificationState.NEEDS_UPDATE,
            )
            (module.source_path / "Content").mkdir(parents=True)
            (module.target_path / "Content" / "New").mkdir(parents=True)
            source_status = WorkingCopyStatus(
                path=item.expected.source_local_path,
                item="error",
                props="",
                error="missing",
            )

            plan = SelectiveUpdatePlanner(
                _StatusSvn(
                    {
                        _key(item.expected.source_local_path): source_status,
                    }
                )
            ).build(_batch(item), (module,))

        self.assertEqual(
            set(plan.targets),
            {
                module.source_path / "Content",
                module.target_path / "Content" / "New",
            },
        )
        self.assertEqual(plan.fallback_count, 1)
        self.assertEqual(plan.stale_target_count, 1)

    def test_too_many_directories_fall_back_to_module_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = WorkspaceModule(
                "res",
                root / "source",
                root / "target",
            )
            files = tuple(
                _verification(module, f"Content/Folder{index}/A.uasset")
                for index in range(3)
            )
            statuses = {}
            for item in files:
                path = Path(item.expected.source_local_path)
                path.parent.mkdir(parents=True)
                path.write_bytes(b"x")
                statuses[_key(path)] = WorkingCopyStatus(
                    path=str(path),
                    item="normal",
                    props="none",
                    repository_item="modified",
                )

            plan = SelectiveUpdatePlanner(
                _StatusSvn(statuses),
                max_targets=2,
            ).build(_batch(*files), (module,))

        self.assertEqual(plan.targets, (module.source_path,))

    @unittest.skipUnless(
        shutil.which("svn") and shutil.which("svnadmin"),
        "SVN command line tools are required",
    )
    def test_real_svn_status_selects_only_stale_file_directory(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="migration selective "
        ) as temp_dir:
            root = Path(temp_dir)
            repository = root / "repository"
            writer = root / "writer"
            reader = root / "reader"
            target = root / "target"
            subprocess.run(
                ["svnadmin", "create", str(repository)],
                check=True,
                capture_output=True,
            )
            trunk_url = repository.resolve().as_uri() + "/trunk"
            subprocess.run(
                ["svn", "mkdir", trunk_url, "-m", "initialize"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["svn", "checkout", trunk_url, str(writer)],
                check=True,
                capture_output=True,
            )
            stale_file = writer / "Content" / "Game" / "A.txt"
            stale_file.parent.mkdir(parents=True)
            stale_file.write_text("one\n", encoding="utf-8")
            subprocess.run(
                ["svn", "add", str(writer / "Content")],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["svn", "commit", str(writer), "-m", "initial file"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["svn", "checkout", trunk_url, str(reader)],
                check=True,
                capture_output=True,
            )
            stale_file.write_text("two\n", encoding="utf-8")
            subprocess.run(
                ["svn", "commit", str(stale_file), "-m", "new revision"],
                check=True,
                capture_output=True,
            )
            target.mkdir()
            module = WorkspaceModule("res", reader, target)
            verification = _verification(
                module,
                "Content/Game/A.txt",
            )

            plan = SelectiveUpdatePlanner(SvnClient()).build(
                _batch(verification),
                (module,),
            )

        self.assertEqual(
            plan.targets,
            (reader / "Content" / "Game",),
        )
        self.assertEqual(plan.stale_source_count, 1)


if __name__ == "__main__":
    unittest.main()
