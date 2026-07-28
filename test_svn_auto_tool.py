import os
import queue
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from svn_auto_tool import RELEASE_ASSET_NAME, RELEASE_DOWNLOAD_URL, SvnAutoTool
from tool_modules import CONFIG_LINKER, KINDLE_STATUS, ToolModuleManager


class _Value:
    def __init__(self, value: object) -> None:
        self.value = value

    def get(self) -> object:
        return self.value

    def set(self, value: object) -> None:
        self.value = value


class ReleaseConfigTests(unittest.TestCase):
    def test_release_asset_name_is_stable_and_url_safe(self) -> None:
        self.assertEqual(RELEASE_ASSET_NAME, "SVNmate.zip")
        asset_url = RELEASE_DOWNLOAD_URL.format(tag="v1.4.0", asset=RELEASE_ASSET_NAME)
        self.assertTrue(asset_url.endswith("/v1.4.0/SVNmate.zip"))


class ToolModuleIntegrationTests(unittest.TestCase):
    def test_empty_config_path_uses_managed_module_location(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tool = SvnAutoTool.__new__(SvnAutoTool)
            tool.tool_module_manager = ToolModuleManager(Path(temp_dir))
            tool.tool_module_paths = {
                CONFIG_LINKER.module_id: _Value(""),
                KINDLE_STATUS.module_id: _Value(""),
            }
            expected = tool.tool_module_manager.executable_path(CONFIG_LINKER)
            expected.parent.mkdir(parents=True)
            expected.write_bytes(b"exe")

            self.assertEqual(
                tool._resolve_tool_module_executable(CONFIG_LINKER),
                expected.resolve(),
            )

    def test_configured_module_path_overrides_managed_location(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            external = Path(temp_dir) / "external" / "KindleLarkStatus.exe"
            external.parent.mkdir()
            external.write_bytes(b"exe")
            tool = SvnAutoTool.__new__(SvnAutoTool)
            tool.tool_module_manager = ToolModuleManager(Path(temp_dir))
            tool.tool_module_paths = {
                CONFIG_LINKER.module_id: _Value(""),
                KINDLE_STATUS.module_id: _Value(str(external)),
            }

            self.assertEqual(
                tool._resolve_tool_module_executable(KINDLE_STATUS),
                external.resolve(),
            )


@unittest.skipUnless(os.name == "nt", "Windows cmd.exe behavior only")
class WindowsBatchCommandTests(unittest.TestCase):
    def test_quoted_batch_command_runs_after_console_wrapping(self) -> None:
        with tempfile.TemporaryDirectory(prefix="SVNmate test ") as temp_dir:
            bat_path = Path(temp_dir) / "Update test.bat"
            bat_path.write_bytes(b"@echo off\r\necho batch-ok\r\nexit /b 0\r\n")
            command = SvnAutoTool._bat_command(bat_path)
            command = SvnAutoTool._add_console_title(command, "SVNmate Test")

            launch_command = SvnAutoTool._windows_cmd_command_line(command)

            self.assertIsInstance(launch_command, str)
            self.assertIn(f'call "{bat_path}"', launch_command)
            self.assertNotIn(f'\\"{bat_path}\\"', launch_command)

            process = subprocess.run(
                launch_command,
                cwd=temp_dir,
                capture_output=True,
                text=True,
                shell=False,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )

            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertIn("batch-ok", process.stdout)

    def test_visible_console_automatically_closes_pause(self) -> None:
        with tempfile.TemporaryDirectory(prefix="SVNmate pause ") as temp_dir:
            bat_path = Path(temp_dir) / "Pause test.bat"
            bat_path.write_bytes(
                b"@echo off\r\ntimeout /t 7 /nobreak >nul\r\npause >nul\r\nexit /b 0\r\n"
            )
            tool = SvnAutoTool.__new__(SvnAutoTool)

            started_at = time.time()
            return_code, _, _ = tool._run_visible_console_command(
                Path(temp_dir),
                tool._bat_command(bat_path),
            )

            self.assertEqual(return_code, 0)
            elapsed = time.time() - started_at
            self.assertGreaterEqual(elapsed, 7)
            self.assertLess(elapsed, 13)


class TaskPipelineTests(unittest.TestCase):
    def test_update_bat_overlaps_later_svn_update_but_finishes_before_cleanup(self) -> None:
        with tempfile.TemporaryDirectory(prefix="SVNmate pipeline ") as temp_dir:
            root = Path(temp_dir)
            bin_folder = root / "bin"
            doc_folder = root / "doc"
            update_bat = bin_folder / "WindowsNoEditor" / "Update.bat"
            update_bat.parent.mkdir(parents=True)
            doc_folder.mkdir()

            tool = SvnAutoTool.__new__(SvnAutoTool)
            tool.run_bin_update = _Value(True)
            tool.run_build_after_cleanup = _Value(False)
            tool.custom_update_bat_path = _Value("")
            tool.custom_build_bat_path = _Value("")
            tool.last_bin_update_date = ""
            tool.log_queue = queue.Queue()
            tool.tortoise_proc = None

            calls: list[tuple[str, str]] = []
            bat_started = threading.Event()
            release_bat = threading.Event()
            bat_finished = threading.Event()

            def fake_run_command(
                cwd: Path,
                _command: list[str],
                action: str,
                auto_cleanup: bool = False,
                visible_console: bool = False,
            ) -> bool:
                del auto_cleanup, visible_console
                calls.append((action, cwd.name))
                if action == "Update.bat":
                    bat_started.set()
                    self.assertTrue(release_bat.wait(2))
                    bat_finished.set()
                    calls.append(("Update.bat finished", cwd.name))
                elif action == "svn update" and cwd == doc_folder:
                    self.assertTrue(bat_started.wait(2))
                    self.assertFalse(bat_finished.is_set())
                    release_bat.set()
                elif action == "svn cleanup":
                    self.assertTrue(bat_finished.is_set())
                return True

            tool._run_command = fake_run_command
            tool._svn_update_command = lambda _folder: ["svn", "update"]
            tool._svn_cleanup_command = lambda _folder: ["svn", "cleanup"]
            tool._find_update_bat_scripts = lambda folder: [update_bat] if folder == bin_folder else []
            tool._find_bin_folders = lambda folder: [bin_folder] if folder == bin_folder else []
            tool._record = lambda *_args: None
            tool._log = lambda *_args: None

            tool._run_all_tasks("test", [str(bin_folder), str(doc_folder)])

            doc_update_index = calls.index(("svn update", "doc"))
            bat_finished_index = calls.index(("Update.bat finished", "WindowsNoEditor"))
            first_cleanup_index = next(index for index, call in enumerate(calls) if call[0] == "svn cleanup")
            self.assertLess(doc_update_index, bat_finished_index)
            self.assertLess(bat_finished_index, first_cleanup_index)
            self.assertTrue(tool.last_bin_update_date)


if __name__ == "__main__":
    unittest.main()
