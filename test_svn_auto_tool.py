import os
import queue
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from svn_auto_tool import (
    APP_VERSION,
    MAX_LIVE_LOG_CHARS,
    RELEASE_ASSET_NAME,
    RELEASE_DOWNLOAD_URL,
    SingleInstanceGuard,
    SvnAutoTool,
    WindowsTrayIcon,
)
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
        asset_url = RELEASE_DOWNLOAD_URL.format(tag=APP_VERSION, asset=RELEASE_ASSET_NAME)
        self.assertTrue(asset_url.endswith("/v1.4.4/SVNmate.zip"))


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


class SelfUpdateTests(unittest.TestCase):
    def test_updater_is_detached_without_inherited_standard_handles(self) -> None:
        with tempfile.TemporaryDirectory(prefix="SVNmate self update ") as temp_dir:
            app_dir = Path(temp_dir)
            update_dir = app_dir / "_updates"
            update_dir.mkdir()
            zip_path = update_dir / RELEASE_ASSET_NAME
            zip_path.write_bytes(b"test")
            tool = SvnAutoTool.__new__(SvnAutoTool)

            with (
                patch("svn_auto_tool.APP_DIR", app_dir),
                patch("svn_auto_tool.os.getpid", return_value=4321),
                patch("svn_auto_tool.subprocess.Popen") as popen,
            ):
                tool._launch_update_installer(zip_path)

            command = popen.call_args.args[0]
            options = popen.call_args.kwargs
            expected_flags = 0
            if os.name == "nt":
                expected_flags = (
                    subprocess.DETACHED_PROCESS
                    | subprocess.CREATE_NEW_PROCESS_GROUP
                    | subprocess.CREATE_NO_WINDOW
                )

            self.assertIn("-NonInteractive", command)
            self.assertIn("Hidden", command)
            self.assertIs(options["stdin"], subprocess.DEVNULL)
            self.assertIs(options["stdout"], subprocess.DEVNULL)
            self.assertIs(options["stderr"], subprocess.DEVNULL)
            self.assertTrue(options["close_fds"])
            self.assertEqual(options["creationflags"], expected_flags)

    def test_update_script_waits_for_executable_unlock_and_logs_result(self) -> None:
        with tempfile.TemporaryDirectory(prefix="SVNmate self update ") as temp_dir:
            app_dir = Path(temp_dir)
            update_dir = app_dir / "_updates"
            update_dir.mkdir()
            zip_path = update_dir / RELEASE_ASSET_NAME
            zip_path.write_bytes(b"test")
            tool = SvnAutoTool.__new__(SvnAutoTool)

            with (
                patch("svn_auto_tool.APP_DIR", app_dir),
                patch("svn_auto_tool.os.getpid", return_value=4321),
                patch("svn_auto_tool.subprocess.Popen"),
            ):
                tool._launch_update_installer(zip_path)

            script_path = update_dir / "apply_update.ps1"
            self.assertTrue(script_path.read_bytes().startswith(b"\xef\xbb\xbf"))
            script = script_path.read_text(encoding="utf-8-sig")
            self.assertIn("$pidToWait = 4321", script)
            self.assertIn("Wait-FileUnlocked $appExe 60", script)
            self.assertIn("[System.IO.FileShare]::None", script)
            self.assertIn("'apply_update.log'", script)
            self.assertIn("Write-UpdateLog '更新完成", script)
            self.assertIn("更新失败：$message", script)


class TrayInteractionTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows named mutex only")
    def test_named_mutex_allows_only_one_running_instance(self) -> None:
        mutex_name = rf"Local\SVNmate.Test.{os.getpid()}.{time.time_ns()}"
        with patch("svn_auto_tool.SINGLE_INSTANCE_MUTEX_NAME", mutex_name):
            primary = SingleInstanceGuard()
            duplicate = SingleInstanceGuard()
            try:
                self.assertTrue(primary.is_primary)
                self.assertFalse(duplicate.is_primary)
            finally:
                duplicate.close()
                primary.close()

            restarted = SingleInstanceGuard()
            try:
                self.assertTrue(restarted.is_primary)
            finally:
                restarted.close()

    def test_pending_actions_dispatch_without_opening_main_window(self) -> None:
        tray = WindowsTrayIcon.__new__(WindowsTrayIcon)
        tray._actions = queue.Queue()
        tray.on_show = Mock()
        tray.on_toggle = Mock()
        tray.on_run = Mock()
        tray.on_exit = Mock()
        module_callback = Mock()
        tray.module_actions = {
            CONFIG_LINKER.module_id: (
                "打开配置关系检索器",
                module_callback,
            )
        }
        for action in (
            "show",
            "toggle",
            "run",
            CONFIG_LINKER.module_id,
            "exit",
        ):
            tray._actions.put(action)

        tray.process_pending_actions()

        tray.on_show.assert_called_once_with()
        tray.on_toggle.assert_called_once_with()
        tray.on_run.assert_called_once_with()
        module_callback.assert_called_once_with()
        tray.on_exit.assert_called_once_with()

    def test_activation_message_queues_show_action(self) -> None:
        tray = WindowsTrayIcon.__new__(WindowsTrayIcon)
        tray._activate_message = 43210
        tray._actions = queue.Queue()

        result = tray._window_proc(0, 43210, 0, 0)

        self.assertEqual(result, 0)
        self.assertEqual(tray._actions.get_nowait(), "show")

    def test_taskbar_recreation_registers_the_icon_again(self) -> None:
        tray = WindowsTrayIcon.__new__(WindowsTrayIcon)
        tray._activate_message = 43210
        tray._taskbar_created_message = 54321
        tray.available = False

        with patch.object(tray, "_add_icon", return_value=True) as add_icon:
            result = tray._window_proc(0, 54321, 0, 0)

        self.assertEqual(result, 0)
        self.assertTrue(tray.available)
        add_icon.assert_called_once_with()

    def test_hide_to_tray_checks_icon_before_hiding_window(self) -> None:
        tool = SvnAutoTool.__new__(SvnAutoTool)
        tool.root = Mock()
        tool.tray_icon = Mock()
        tool.tray_icon.ensure_visible.return_value = True

        tool._hide_to_tray()

        tool.tray_icon.ensure_visible.assert_called_once_with()
        tool.root.withdraw.assert_called_once_with()

    def test_hide_to_tray_keeps_window_open_when_icon_is_unavailable(self) -> None:
        tool = SvnAutoTool.__new__(SvnAutoTool)
        tool.root = Mock()
        tool.tray_icon = Mock()
        tool.tray_icon.ensure_visible.return_value = False

        with (
            patch.object(tool, "_log") as log,
            patch("svn_auto_tool.messagebox.showwarning") as showwarning,
        ):
            tool._hide_to_tray()

        tool.root.withdraw.assert_not_called()
        log.assert_called_once()
        showwarning.assert_called_once()

    def test_double_click_hides_window_when_it_is_visible(self) -> None:
        tool = SvnAutoTool.__new__(SvnAutoTool)

        with (
            patch.object(tool, "_is_main_window_visible", return_value=True),
            patch.object(tool, "_hide_to_tray") as hide,
            patch.object(tool, "_show_from_tray") as show,
        ):
            tool._toggle_from_tray()

        hide.assert_called_once_with()
        show.assert_not_called()

    def test_double_click_shows_window_when_it_is_hidden(self) -> None:
        tool = SvnAutoTool.__new__(SvnAutoTool)

        with (
            patch.object(tool, "_is_main_window_visible", return_value=False),
            patch.object(tool, "_hide_to_tray") as hide,
            patch.object(tool, "_show_from_tray") as show,
        ):
            tool._toggle_from_tray()

        show.assert_called_once_with()
        hide.assert_not_called()


class LiveLogMemoryTests(unittest.TestCase):
    def test_long_live_log_entry_is_truncated_but_disk_log_is_complete(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tool = SvnAutoTool.__new__(SvnAutoTool)
            tool.log_queue = queue.Queue(maxsize=10)
            tool.dropped_live_log_items = 0
            long_line = "x" * (MAX_LIVE_LOG_CHARS + 500)

            with patch("svn_auto_tool.LOG_DIR", Path(temp_dir)):
                tool._log(long_line)
                log_path = tool._current_log_path()

            item_type, live_text = tool.log_queue.get_nowait()
            self.assertEqual(item_type, "log")
            self.assertIn("界面已截断", live_text)
            self.assertLess(len(live_text), len(long_line))
            self.assertIn(long_line, log_path.read_text(encoding="utf-8"))

    def test_full_live_log_queue_drops_ui_item_without_losing_disk_log(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tool = SvnAutoTool.__new__(SvnAutoTool)
            tool.log_queue = queue.Queue(maxsize=1)
            tool.log_queue.put(("log", "existing"))
            tool.dropped_live_log_items = 0

            with patch("svn_auto_tool.LOG_DIR", Path(temp_dir)):
                tool._log("disk-only")
                log_path = tool._current_log_path()

            self.assertEqual(tool.dropped_live_log_items, 1)
            self.assertIn("disk-only", log_path.read_text(encoding="utf-8"))


class FolderInteractionTests(unittest.TestCase):
    def test_right_click_selects_folder_and_opens_context_action(self) -> None:
        tool = SvnAutoTool.__new__(SvnAutoTool)
        tree = Mock()
        tree.identify_row.return_value = "0"
        tool.folder_trees = {"left": tree}
        tool.folder_groups = {
            "left": [{"path": r"C:\trunk\doc", "enabled": True}],
            "right": [],
        }
        event = SimpleNamespace(y=12, x_root=320, y_root=240)
        menu = Mock()

        with (
            patch("svn_auto_tool.Menu", return_value=menu),
            patch.object(tool, "_open_folder") as open_folder,
        ):
            tool._show_folder_context_menu(event, "left")
            command = menu.add_command.call_args.kwargs["command"]
            command()

        tree.selection_set.assert_called_once_with("0")
        tree.focus.assert_called_once_with("0")
        menu.tk_popup.assert_called_once_with(320, 240)
        menu.grab_release.assert_called_once_with()
        open_folder.assert_called_once_with("left", 0)

    @unittest.skipUnless(hasattr(os, "startfile"), "Windows folder opening only")
    def test_open_folder_uses_windows_shell(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            tool = SvnAutoTool.__new__(SvnAutoTool)
            tool.folder_groups = {
                "left": [{"path": str(folder), "enabled": True}],
                "right": [],
            }

            with patch("svn_auto_tool.os.startfile") as startfile:
                opened = tool._open_folder("left", 0)

            self.assertTrue(opened)
            startfile.assert_called_once_with(str(folder))


class SvnRecoveryTests(unittest.TestCase):
    def _build_tool(
        self,
        update_results: list[int],
        cleanup_result: int = 0,
    ) -> tuple[SvnAutoTool, list[str], list[tuple[str, str]]]:
        tool = SvnAutoTool.__new__(SvnAutoTool)
        tool.tortoise_proc = "TortoiseProc.exe"
        calls: list[str] = []
        records: list[tuple[str, str]] = []
        remaining_updates = iter(update_results)

        def run_tortoise(
            _cwd: Path,
            command: list[str],
        ) -> tuple[int, str, str]:
            if "/command:cleanup" in command:
                calls.append("cleanup")
                return cleanup_result, "", ""
            calls.append("update")
            return next(remaining_updates), "", ""

        tool._run_tortoise_command = run_tortoise
        tool._svn_cleanup_command = lambda _folder: [
            "TortoiseProc.exe",
            "/command:cleanup",
        ]
        tool._log = lambda *_args: None
        tool._record = lambda _folder, _action, status, message: records.append(
            (status, message)
        )
        return tool, calls, records

    def test_failed_update_runs_cleanup_then_retries_once(self) -> None:
        tool, calls, records = self._build_tool([4294967295, 0])

        succeeded = tool._run_command(
            Path(r"C:\trunk\doc"),
            ["TortoiseProc.exe", "/command:update"],
            "svn update",
            auto_cleanup=True,
        )

        self.assertTrue(succeeded)
        self.assertEqual(calls, ["update", "cleanup", "update"])
        self.assertIn("自动恢复", [status for status, _message in records])
        self.assertIn("重试", [status for status, _message in records])

    def test_retry_failure_does_not_start_another_cleanup(self) -> None:
        tool, calls, _records = self._build_tool([4294967295, 4294967295])

        succeeded = tool._run_command(
            Path(r"C:\trunk\doc"),
            ["TortoiseProc.exe", "/command:update"],
            "svn update",
            auto_cleanup=True,
        )

        self.assertFalse(succeeded)
        self.assertEqual(calls, ["update", "cleanup", "update"])


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
