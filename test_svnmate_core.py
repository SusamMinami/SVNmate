import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from svnmate_core import (
    CommandExecution,
    WorkspaceUpdateService,
    create_cli_update_service,
    dedupe_folders,
    needs_svn_cleanup,
)


class _SequenceExecutor:
    def __init__(self, results: list[CommandExecution]) -> None:
        self.results = iter(results)
        self.calls: list[tuple[Path, tuple[str, ...], str]] = []

    def __call__(
        self,
        cwd: Path,
        command: object,
        action: str,
    ) -> CommandExecution:
        self.calls.append((cwd, tuple(command), action))
        return next(self.results)


class WorkspaceUpdateServiceTests(unittest.TestCase):
    def _service(
        self,
        executor: _SequenceExecutor,
        events: list[tuple[str, str]],
    ) -> WorkspaceUpdateService:
        return WorkspaceUpdateService(
            executor=executor,
            update_command=lambda _folder: ["svn", "update"],
            cleanup_command=lambda _folder: ["svn", "cleanup"],
            event_sink=lambda event: events.append(
                (event.action, event.status)
            ),
        )

    def test_successful_update_does_not_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            executor = _SequenceExecutor([CommandExecution(0)])
            events: list[tuple[str, str]] = []

            result = self._service(executor, events).update_folder(temp_dir)

        self.assertTrue(result.success)
        self.assertEqual(result.status, "updated")
        self.assertEqual(result.update_attempts, 1)
        self.assertFalse(result.cleanup_attempted)
        self.assertEqual(
            [action for _cwd, _command, action in executor.calls],
            ["svn update"],
        )

    def test_failed_update_cleans_then_retries_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            executor = _SequenceExecutor(
                [
                    CommandExecution(1, error="working copy locked"),
                    CommandExecution(0),
                    CommandExecution(0),
                ]
            )
            events: list[tuple[str, str]] = []

            result = self._service(executor, events).update_folder(temp_dir)

        self.assertTrue(result.success)
        self.assertEqual(result.status, "updated-after-cleanup")
        self.assertEqual(result.update_attempts, 2)
        self.assertTrue(result.cleanup_attempted)
        self.assertEqual(
            [action for _cwd, _command, action in executor.calls],
            ["svn update", "svn cleanup(自动恢复)", "svn update"],
        )
        self.assertIn(("svn update", "自动恢复"), events)
        self.assertIn(("svn update", "重试"), events)

    def test_cleanup_failure_stops_retry(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            executor = _SequenceExecutor(
                [
                    CommandExecution(1, error="update failed"),
                    CommandExecution(1, error="cleanup failed"),
                ]
            )
            events: list[tuple[str, str]] = []

            result = self._service(executor, events).update_folder(temp_dir)

        self.assertFalse(result.success)
        self.assertEqual(result.status, "cleanup-failed")
        self.assertEqual(result.update_attempts, 1)
        self.assertEqual(len(executor.calls), 2)

    def test_missing_folder_returns_structured_failure(self) -> None:
        executor = _SequenceExecutor([])
        events: list[tuple[str, str]] = []

        result = self._service(executor, events).update_folder(
            Path("definitely-missing-svnmate-folder")
        )

        self.assertFalse(result.success)
        self.assertEqual(result.status, "missing")
        self.assertEqual(result.update_attempts, 0)
        self.assertEqual(executor.calls, [])
        self.assertEqual(events[-1], ("检查文件夹", "失败"))

    def test_batch_deduplicates_folders_and_serializes_result(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            executor = _SequenceExecutor([CommandExecution(0)])
            events: list[tuple[str, str]] = []
            service = self._service(executor, events)

            result = service.update_folders(
                [temp_dir, Path(temp_dir)],
                request_id="request-1",
            )
            payload = result.to_dict(executed_by="core")

        self.assertTrue(result.success)
        self.assertEqual(len(result.folders), 1)
        self.assertEqual(payload["request_id"], "request-1")
        self.assertEqual(payload["executed_by"], "core")
        self.assertEqual(payload["status"], "completed")


class CoreUtilityTests(unittest.TestCase):
    def test_cleanup_message_detection(self) -> None:
        self.assertTrue(needs_svn_cleanup("E155004: Working copy locked"))
        self.assertFalse(needs_svn_cleanup("authorization failed"))

    def test_dedupe_folders_is_case_insensitive_on_windows(self) -> None:
        folders = dedupe_folders([r"C:\Work\Res", r"c:\work\res"])
        expected = 1 if __import__("os").name == "nt" else 2
        self.assertEqual(len(folders), expected)

    @unittest.skipUnless(
        shutil.which("svn") and shutil.which("svnadmin"),
        "SVN command line tools are required",
    )
    def test_cli_service_updates_real_working_copy(self) -> None:
        with tempfile.TemporaryDirectory(prefix="svnmate core ") as temp_dir:
            root = Path(temp_dir)
            repository = root / "repository"
            writer = root / "writer"
            reader = root / "reader"
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
            subprocess.run(
                ["svn", "checkout", trunk_url, str(reader)],
                check=True,
                capture_output=True,
            )
            source_file = writer / "updated.txt"
            source_file.write_text("updated\n", encoding="utf-8")
            subprocess.run(
                ["svn", "add", str(source_file)],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["svn", "commit", str(writer), "-m", "add fixture"],
                check=True,
                capture_output=True,
            )

            result = create_cli_update_service().update_folders([reader])

            self.assertTrue(result.success)
            self.assertEqual(
                (reader / "updated.txt").read_text(encoding="utf-8"),
                "updated\n",
            )


if __name__ == "__main__":
    unittest.main()
