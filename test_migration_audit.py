import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import date
from pathlib import Path

from migration_guard.audit import MigrationAuditService
from migration_guard.models import (
    MigrationCase,
    SvnChange,
    SvnCommit,
    SvnInfo,
    VerificationState,
    WorkingCopyStatus,
    WorkspaceModule,
)
from migration_guard.svn_client import (
    SvnCommandOutput,
    SvnClient,
    issue_keys_in_message,
    message_has_issue,
    normalize_issue_key,
)


def _path_key(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


class _FakeSvnClient:
    def __init__(
        self,
        source: Path,
        target: Path,
        source_commits: tuple[SvnCommit, ...],
        target_commits: tuple[SvnCommit, ...],
        statuses: dict[str, WorkingCopyStatus],
    ) -> None:
        self.source = source
        self.target = target
        self.source_commits = source_commits
        self.target_commits = target_commits
        self.statuses = statuses
        self.log_by_issues_calls = 0
        self.log_by_message_pattern_calls = 0
        self.last_message_pattern = ""

    def info(self, path: Path | str) -> SvnInfo:
        target = Path(path)
        is_source = target == self.source
        return SvnInfo(
            path=str(target),
            url=(
                "https://example.invalid/project/res/trunk"
                if is_source
                else "https://example.invalid/project/res/overseas/trunk"
            ),
            relative_url=(
                "^/project/res/trunk"
                if is_source
                else "^/project/res/overseas/trunk"
            ),
            repository_root="https://example.invalid",
            repository_uuid="repository-1",
            revision=20 if is_source else 30,
            wc_root=str(target),
            kind="dir",
        )

    def external_paths(self, _root: Path | str) -> tuple[Path, ...]:
        return ()

    def log_by_issue(
        self,
        target: Path | str,
        _issue_key: str,
        *,
        start: date | str,
    ) -> tuple[SvnCommit, ...]:
        del start
        return (
            self.source_commits
            if Path(target) == self.source
            else self.target_commits
        )

    def log_by_issues(
        self,
        target: Path | str,
        _issue_keys: object,
        *,
        start: date | str,
    ) -> tuple[SvnCommit, ...]:
        self.log_by_issues_calls += 1
        return self.log_by_issue(target, "", start=start)

    def log_by_message_pattern(
        self,
        target: Path | str,
        search_pattern: str,
        *,
        start: date | str,
    ) -> tuple[SvnCommit, ...]:
        self.log_by_message_pattern_calls += 1
        self.last_message_pattern = search_pattern
        return self.log_by_issue(target, "", start=start)

    def status_paths(
        self,
        _paths: object,
        *,
        show_updates: bool,
    ) -> dict[str, WorkingCopyStatus]:
        self.last_show_updates = show_updates
        return self.statuses


class MigrationAuditDecisionTests(unittest.TestCase):
    def test_audit_classifies_local_and_committed_states(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source" / "res"
            target = root / "target" / "res"
            source.mkdir(parents=True)
            target.mkdir(parents=True)
            for name in ("pending.txt", "untouched.txt", "complete.txt"):
                (target / name).write_text(name, encoding="utf-8")

            source_commits = (
                SvnCommit(
                    revision=10,
                    author="author-a",
                    date="2026-09-01T00:00:00Z",
                    message="[SERIA-123] source",
                    changes=(
                        SvnChange(
                            "M",
                            "/project/res/trunk/pending.txt",
                            "file",
                        ),
                        SvnChange(
                            "A",
                            "/project/res/trunk/untouched.txt",
                            "file",
                        ),
                        SvnChange(
                            "M",
                            "/project/res/trunk/complete.txt",
                            "file",
                        ),
                        SvnChange(
                            "D",
                            "/project/res/trunk/deleted.txt",
                            "file",
                        ),
                    ),
                ),
            )
            target_commits = (
                SvnCommit(
                    revision=15,
                    author="author-b",
                    date="2026-09-02T00:00:00Z",
                    message="[OSCOA-456] target",
                    changes=(
                        SvnChange(
                            "M",
                            "/project/res/overseas/trunk/complete.txt",
                            "file",
                        ),
                        SvnChange(
                            "D",
                            "/project/res/overseas/trunk/deleted.txt",
                            "file",
                        ),
                    ),
                ),
            )
            pending_path = target / "pending.txt"
            statuses = {
                _path_key(pending_path): WorkingCopyStatus(
                    path=str(pending_path),
                    item="modified",
                    props="none",
                )
            }
            svn = _FakeSvnClient(
                source,
                target,
                source_commits,
                target_commits,
                statuses,
            )

            result = MigrationAuditService(
                svn=svn,
                include_externals=False,
            ).audit(
                [WorkspaceModule("res", source, target)],
                "SERIA-123",
                "OSCOA-456",
                lookback_days=30,
            )

        states = {
            Path(item.expected.target_local_path).name: item.state
            for item in result.files
        }
        self.assertEqual(
            states,
            {
                "complete.txt": VerificationState.COMPLETE,
                "deleted.txt": VerificationState.COMPLETE,
                "pending.txt": VerificationState.PENDING_COMMIT,
                "untouched.txt": VerificationState.NOT_MIGRATED,
            },
        )
        self.assertFalse(result.complete)
        self.assertTrue(svn.last_show_updates)

    def test_reversed_source_and_target_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source" / "res"
            target = root / "target" / "res"
            source.mkdir(parents=True)
            target.mkdir(parents=True)
            svn = _FakeSvnClient(source, target, (), (), {})

            with self.assertRaisesRegex(ValueError, "配置反向"):
                MigrationAuditService(
                    svn=svn,
                    include_externals=False,
                ).audit(
                    [WorkspaceModule("res", target, source)],
                    "SERIA-123",
                    "OSCOA-456",
                    lookback_days=30,
                )

    def test_batch_audit_scans_each_working_copy_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source" / "res"
            target = root / "target" / "res"
            source.mkdir(parents=True)
            target.mkdir(parents=True)
            (target / "a.txt").write_text("a", encoding="utf-8")
            (target / "b.txt").write_text("b", encoding="utf-8")
            source_commits = (
                SvnCommit(
                    10,
                    "a",
                    "2026-09-01T00:00:00Z",
                    "[SERIA-10] first",
                    (
                        SvnChange(
                            "M",
                            "/project/res/trunk/a.txt",
                            "file",
                        ),
                    ),
                ),
                SvnCommit(
                    11,
                    "b",
                    "2026-09-01T00:00:01Z",
                    "[SERIA-11] second",
                    (
                        SvnChange(
                            "M",
                            "/project/res/trunk/b.txt",
                            "file",
                        ),
                    ),
                ),
            )
            target_commits = (
                SvnCommit(
                    20,
                    "c",
                    "2026-09-02T00:00:00Z",
                    "[OSCOA-20] first",
                    (
                        SvnChange(
                            "M",
                            "/project/res/overseas/trunk/a.txt",
                            "file",
                        ),
                    ),
                ),
                SvnCommit(
                    21,
                    "d",
                    "2026-09-02T00:00:01Z",
                    "[OSCOA-21] second",
                    (
                        SvnChange(
                            "M",
                            "/project/res/overseas/trunk/b.txt",
                            "file",
                        ),
                    ),
                ),
            )
            svn = _FakeSvnClient(
                source,
                target,
                source_commits,
                target_commits,
                {},
            )

            result = MigrationAuditService(
                svn=svn,
                include_externals=False,
            ).audit_batch(
                [WorkspaceModule("res", source, target)],
                (
                    MigrationCase("SERIA-10", "OSCOA-20"),
                    MigrationCase("SERIA-11", "OSCOA-21"),
                ),
                lookback_days=30,
            )

        self.assertEqual(svn.log_by_issues_calls, 1)
        self.assertEqual(svn.log_by_message_pattern_calls, 1)
        self.assertEqual(svn.last_message_pattern, "*OSCOA-*")
        self.assertEqual(len(result.cases), 2)
        self.assertEqual(len(result.files), 2)
        self.assertTrue(result.complete)

    def test_batch_accepts_same_path_committed_by_another_ticket(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source" / "res"
            target = root / "target" / "res"
            source.mkdir(parents=True)
            target.mkdir(parents=True)
            target_file = target / "shared.uasset"
            target_file.write_bytes(b"shared")
            source_commits = (
                SvnCommit(
                    10,
                    "a",
                    "2026-09-01T00:00:00Z",
                    "[SERIA-10] first",
                    (
                        SvnChange(
                            "M",
                            "/project/res/trunk/shared.uasset",
                            "file",
                        ),
                    ),
                ),
                SvnCommit(
                    11,
                    "b",
                    "2026-09-01T00:00:01Z",
                    "[SERIA-11] second",
                    (
                        SvnChange(
                            "M",
                            "/project/res/trunk/shared.uasset",
                            "file",
                        ),
                    ),
                ),
            )
            target_commits = (
                SvnCommit(
                    20,
                    "c",
                    "2026-09-02T00:00:00Z",
                    "[OSCOA-21] shared target",
                    (
                        SvnChange(
                            "M",
                            "/project/res/overseas/trunk/shared.uasset",
                            "file",
                        ),
                    ),
                ),
            )
            svn = _FakeSvnClient(
                source,
                target,
                source_commits,
                target_commits,
                {},
            )

            result = MigrationAuditService(
                svn=svn,
                include_externals=False,
            ).audit_batch(
                [WorkspaceModule("res", source, target)],
                (
                    MigrationCase("SERIA-10", "OSCOA-20"),
                    MigrationCase("SERIA-11", "OSCOA-21"),
                ),
                lookback_days=30,
            )

        self.assertEqual(
            result.cases[0].files[0].state,
            VerificationState.SUBMITTED,
        )
        self.assertIn(
            "OSCOA-21",
            result.cases[0].files[0].reason,
        )
        self.assertEqual(
            result.cases[1].files[0].state,
            VerificationState.COMPLETE,
        )
        self.assertTrue(result.complete)


class IssueParsingTests(unittest.TestCase):
    def test_normalize_issue_accepts_decorated_text(self) -> None:
        self.assertEqual(
            normalize_issue_key("【seria-12345】【配置】说明"),
            "SERIA-12345",
        )

    def test_issue_match_does_not_accept_longer_number(self) -> None:
        self.assertTrue(message_has_issue("[SERIA-123] valid", "SERIA-123"))
        self.assertFalse(
            message_has_issue("[SERIA-1234] different", "SERIA-123")
        )

    def test_issue_keys_extract_multiple_overseas_tickets(self) -> None:
        self.assertEqual(
            issue_keys_in_message(
                "【OSCOA-20】共享提交 Source: SERIA-10 / OSCOA-21"
            ),
            ("OSCOA-20", "SERIA-10", "OSCOA-21"),
        )

    def test_external_properties_support_revision_and_quoted_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            owner = Path(temp_dir)
            expected = (
                owner / "Effects",
                owner / "Tables",
                owner / "Quoted Path",
            )
            for path in expected:
                path.mkdir()
            xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<properties>
  <target path="{owner.as_posix()}">
    <property name="svn:externals">^/art/Effects Effects
-r 123 ^/doc/Tables Tables
"Quoted Path" ^/art/Quoted</property>
  </target>
</properties>
"""

            def runner(command, cwd, timeout):
                del cwd, timeout
                return SvnCommandOutput(
                    command=tuple(command),
                    return_code=0,
                    stdout=xml,
                    stderr="",
                    elapsed_seconds=0,
                )

            paths = SvnClient(runner=runner).external_paths(owner)

        self.assertEqual(paths, expected)

    def test_multiple_issue_search_uses_one_svn_log_command(self) -> None:
        seen: list[tuple[str, ...]] = []
        xml = """<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="10">
    <author>a</author><date>2026-09-01T00:00:00Z</date>
    <paths><path action="M" kind="file">/a.txt</path></paths>
    <msg>[SERIA-10] first</msg>
  </logentry>
  <logentry revision="11">
    <author>b</author><date>2026-09-01T00:00:01Z</date>
    <paths><path action="M" kind="file">/b.txt</path></paths>
    <msg>[SERIA-11] second</msg>
  </logentry>
</log>
"""

        def runner(command, cwd, timeout):
            del cwd, timeout
            seen.append(tuple(command))
            return SvnCommandOutput(
                command=tuple(command),
                return_code=0,
                stdout=xml,
                stderr="",
                elapsed_seconds=0,
            )

        commits = SvnClient(runner=runner).log_by_issues(
            "https://example.invalid/trunk",
            ("SERIA-10", "SERIA-11"),
            start="2026-09-01",
        )

        self.assertEqual([item.revision for item in commits], [10, 11])
        self.assertEqual(seen[0].count("--search"), 2)


@unittest.skipUnless(
    shutil.which("svn") and shutil.which("svnadmin"),
    "SVN command line tools are required",
)
class MigrationAuditSvnIntegrationTests(unittest.TestCase):
    def test_real_repository_reports_committed_then_pending_change(self) -> None:
        with tempfile.TemporaryDirectory(prefix="migration audit ") as temp_dir:
            root = Path(temp_dir)
            repository = root / "repository"
            source = root / "source"
            target = root / "target"
            subprocess.run(
                ["svnadmin", "create", str(repository)],
                check=True,
                capture_output=True,
            )
            base_url = repository.resolve().as_uri() + "/project/res"
            source_url = base_url + "/trunk"
            target_url = base_url + "/overseas/trunk"
            subprocess.run(
                [
                    "svn",
                    "mkdir",
                    "--parents",
                    source_url,
                    target_url,
                    "-m",
                    "initialize branches",
                ],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["svn", "checkout", source_url, str(source)],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["svn", "checkout", target_url, str(target)],
                check=True,
                capture_output=True,
            )

            source_file = source / "Content" / "Example.txt"
            source_file.parent.mkdir()
            source_file.write_text("source\n", encoding="utf-8")
            subprocess.run(
                ["svn", "add", "--parents", str(source_file)],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["svn", "commit", str(source), "-m", "[SERIA-123] source"],
                check=True,
                capture_output=True,
            )

            target_file = target / "Content" / "Example.txt"
            target_file.parent.mkdir()
            target_file.write_text("target\n", encoding="utf-8")
            subprocess.run(
                ["svn", "add", "--parents", str(target_file)],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["svn", "commit", str(target), "-m", "[OSCOA-456] target"],
                check=True,
                capture_output=True,
            )

            service = MigrationAuditService(
                svn=SvnClient(timeout=30),
                include_externals=False,
            )
            module = WorkspaceModule("res", source, target)
            completed = service.audit(
                [module],
                "SERIA-123",
                "OSCOA-456",
                lookback_days=30,
            )
            self.assertEqual(
                completed.files[0].state,
                VerificationState.COMPLETE,
            )

            target_file.write_text("pending\n", encoding="utf-8")
            pending = service.audit(
                [module],
                "SERIA-123",
                "OSCOA-456",
                lookback_days=30,
            )
            self.assertEqual(
                pending.files[0].state,
                VerificationState.PENDING_COMMIT,
            )


if __name__ == "__main__":
    unittest.main()
