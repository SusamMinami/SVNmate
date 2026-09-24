import hashlib
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from module_updates import ModuleManifest, ModuleUpdateError
from tool_modules import (
    CONFIG_LINKER,
    KINDLE_STATUS,
    MIGRATION_GUARD,
    SERIA_QA_OVERLAY,
    ToolModuleManager,
    module_paths_from_config,
)


class ToolModuleManagerTests(unittest.TestCase):
    def test_kindle_uses_public_svnmate_release_channel(self) -> None:
        self.assertEqual(
            KINDLE_STATUS.manifest_url,
            (
                "https://github.com/SusamMinami/SVNmate/releases/download/"
                "kindle-windows-latest/manifest.json"
            ),
        )

    def test_migration_guard_uses_its_own_release_channel(self) -> None:
        self.assertTrue(MIGRATION_GUARD.supports_updates)
        self.assertEqual(
            MIGRATION_GUARD.manifest_url,
            (
                "https://github.com/SusamMinami/SVNmate/releases/download/"
                "migration-guard-latest/manifest.json"
            ),
        )

    def test_seria_qa_overlay_uses_managed_installer_channel(self) -> None:
        self.assertEqual(SERIA_QA_OVERLAY.module_kind, "installer")
        self.assertFalse(SERIA_QA_OVERLAY.allow_custom_path)
        self.assertEqual(
            SERIA_QA_OVERLAY.manifest_url,
            (
                "https://github.com/SusamMinami/SVNmate/releases/download/"
                "seria-qa-overlay-latest/module-manifest.json"
            ),
        )

    def test_old_kindle_path_migrates_into_module_paths(self) -> None:
        paths = module_paths_from_config(
            {"kindle_status_path": r"D:\Kindle\KindleLarkStatus.exe"},
            detected_config_linker="",
            detected_kindle_status="",
        )

        self.assertEqual(
            paths["kindle-lark-status"],
            r"D:\Kindle\KindleLarkStatus.exe",
        )

    def test_new_module_paths_override_detected_defaults(self) -> None:
        paths = module_paths_from_config(
            {
                "tool_module_paths": {
                    "config-linker": r"D:\Tools\ConfigLinker.exe",
                    "kindle-lark-status": r"D:\Tools\KindleLarkStatus.exe",
                    "migration-guard": r"D:\Tools\MigrationGuard.exe",
                }
            },
            detected_config_linker=r"C:\Default\ConfigLinker.exe",
            detected_kindle_status=r"C:\Default\KindleLarkStatus.exe",
            detected_migration_guard=r"C:\Default\MigrationGuard.exe",
        )

        self.assertEqual(paths["config-linker"], r"D:\Tools\ConfigLinker.exe")
        self.assertEqual(
            paths["kindle-lark-status"],
            r"D:\Tools\KindleLarkStatus.exe",
        )
        self.assertEqual(
            paths["migration-guard"],
            r"D:\Tools\MigrationGuard.exe",
        )
        self.assertEqual(paths["seria-qa-overlay"], "")

    def test_default_and_configured_paths_are_resolved(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app_dir = Path(temp_dir)
            manager = ToolModuleManager(app_dir)

            self.assertEqual(
                manager.executable_path(CONFIG_LINKER),
                app_dir / "modules" / "ConfigLinker" / "ConfigLinker.exe",
            )
            self.assertEqual(
                manager.executable_path(MIGRATION_GUARD),
                app_dir / "modules" / "MigrationGuard" / "MigrationGuard.exe",
            )
            self.assertEqual(
                manager.executable_path(SERIA_QA_OVERLAY),
                (
                    app_dir
                    / "modules"
                    / "SeriaQAOverlay"
                    / "Install-SeriaQA.cmd"
                ),
            )
            configured = app_dir / "external" / "KindleLarkStatus.exe"
            self.assertEqual(
                manager.executable_path(KINDLE_STATUS, configured),
                configured,
            )
            self.assertEqual(
                manager.executable_path(
                    SERIA_QA_OVERLAY,
                    app_dir / "external" / "Install-SeriaQA.cmd",
                ),
                (
                    app_dir
                    / "modules"
                    / "SeriaQAOverlay"
                    / "Install-SeriaQA.cmd"
                ),
            )

    def test_local_version_reads_public_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app_dir = Path(temp_dir)
            manager = ToolModuleManager(app_dir)
            executable = manager.executable_path(CONFIG_LINKER)
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b"exe")
            (executable.parent / "VERSION").write_text("1.1.0\n", encoding="utf-8")

            self.assertEqual(manager.local_version(CONFIG_LINKER), "1.1.0")

    def test_launch_reports_missing_running_and_started(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app_dir = Path(temp_dir)
            launched: list[Path] = []
            running = False

            def process_checker(_name: str) -> bool:
                return running

            manager = ToolModuleManager(
                app_dir,
                process_checker=process_checker,
                launcher=lambda path: launched.append(path),
            )
            self.assertEqual(manager.launch(CONFIG_LINKER), "install-required")

            executable = manager.executable_path(CONFIG_LINKER)
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b"exe")
            self.assertEqual(manager.launch(CONFIG_LINKER), "started")
            self.assertEqual(launched, [executable])

            running = True
            self.assertEqual(manager.launch(CONFIG_LINKER), "already-running")

    def test_stop_running_module_uses_injected_stopper(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            running = True
            stopped: list[str] = []

            def process_checker(_name: str) -> bool:
                return running

            def process_stopper(name: str) -> bool:
                nonlocal running
                stopped.append(name)
                running = False
                return True

            manager = ToolModuleManager(
                Path(temp_dir),
                process_checker=process_checker,
                process_stopper=process_stopper,
            )

            self.assertTrue(manager.stop(CONFIG_LINKER))
            self.assertEqual(stopped, ["ConfigLinker.exe"])
            self.assertFalse(manager.is_running(CONFIG_LINKER))

    def test_installer_module_never_force_stops_game(self) -> None:
        stopped: list[str] = []
        manager = ToolModuleManager(
            Path("C:/SVNmate"),
            process_checker=lambda _name: True,
            process_stopper=lambda name: stopped.append(name) is None,
        )

        self.assertFalse(manager.stop(SERIA_QA_OVERLAY))
        self.assertEqual(stopped, [])

    def test_check_update_uses_expected_module_id(self) -> None:
        payload = {
            "id": "config-linker",
            "version": "1.1.0",
            "download_url": "https://example.com/ConfigLinker.zip",
            "sha256": "a" * 64,
            "entrypoint": "ConfigLinker.exe",
        }
        calls: list[tuple[str, str]] = []

        def fetcher(url: str, expected_id: str) -> ModuleManifest:
            calls.append((url, expected_id))
            return ModuleManifest.from_dict(payload, expected_id=expected_id)

        manager = ToolModuleManager(Path("C:/SVNmate"), manifest_fetcher=fetcher)

        manifest = manager.check_update(CONFIG_LINKER)

        self.assertEqual(manifest.version, "1.1.0")
        self.assertEqual(
            calls,
            [(CONFIG_LINKER.manifest_url, "config-linker")],
        )

    def test_check_update_rejects_unexpected_entrypoint(self) -> None:
        payload = {
            "id": "seria-qa-overlay",
            "version": "2026.9.22",
            "download_url": "https://example.com/SeriaQA.zip",
            "sha256": "a" * 64,
            "entrypoint": "Unexpected.cmd",
        }

        def fetcher(_url: str, expected_id: str) -> ModuleManifest:
            return ModuleManifest.from_dict(payload, expected_id=expected_id)

        manager = ToolModuleManager(
            Path("C:/SVNmate"),
            manifest_fetcher=fetcher,
        )

        with self.assertRaisesRegex(ModuleUpdateError, "入口不匹配"):
            manager.check_update(SERIA_QA_OVERLAY)

    def test_install_archive_writes_exe_and_version_without_touching_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app_dir = Path(temp_dir)
            archive = app_dir / "ConfigLinker.zip"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("ConfigLinker/ConfigLinker.exe", b"new-exe")
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            manifest = ModuleManifest.from_dict(
                {
                    "id": "config-linker",
                    "version": "1.1.0",
                    "download_url": "https://example.com/ConfigLinker.zip",
                    "sha256": digest,
                    "entrypoint": "ConfigLinker.exe",
                },
                expected_id="config-linker",
            )
            manager = ToolModuleManager(app_dir)
            target = manager.executable_path(CONFIG_LINKER)
            target.parent.mkdir(parents=True)
            config = target.parent / "config_linker_config.json"
            config.write_text('{"doc_directory":"D:/doc"}', encoding="utf-8")

            manager.install_archive(CONFIG_LINKER, manifest, archive)

            self.assertEqual(target.read_bytes(), b"new-exe")
            self.assertEqual(
                (target.parent / "VERSION").read_text(encoding="utf-8"),
                "1.1.0\n",
            )
            self.assertEqual(
                config.read_text(encoding="utf-8"),
                '{"doc_directory":"D:/doc"}',
            )

    def test_installer_package_is_applied_before_version_is_committed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app_dir = Path(temp_dir)
            archive = app_dir / "SeriaQA.zip"
            package_prefix = "Seria-QA-Overlay-2026.09.22"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr(
                    f"{package_prefix}/Install-SeriaQA.cmd",
                    b"@echo off\r\n",
                )
                handle.writestr(
                    f"{package_prefix}/Install-SeriaTool.ps1",
                    b"Write-Host install\r\n",
                )
                handle.writestr(
                    f"{package_prefix}/Publish-Persistent-Recovery.ps1",
                    b"Write-Host publish\r\n",
                )
                handle.writestr(
                    f"{package_prefix}/manifest.json",
                    b"{}\n",
                )
                handle.writestr(
                    f"{package_prefix}/payload/overlay.addon64",
                    b"addon",
                )
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            manifest = ModuleManifest.from_dict(
                {
                    "id": "seria-qa-overlay",
                    "version": "2026.9.22",
                    "download_url": "https://example.com/SeriaQA.zip",
                    "sha256": digest,
                    "entrypoint": "Install-SeriaQA.cmd",
                },
                expected_id="seria-qa-overlay",
            )
            applied: list[Path] = []

            def installer(_spec: object, package_root: Path) -> None:
                applied.append(package_root)
                logs = package_root / "logs"
                logs.mkdir(exist_ok=True)
                (logs / "new.log").write_text("new", encoding="utf-8")

            manager = ToolModuleManager(
                app_dir,
                package_installer=installer,
            )
            target = manager.executable_path(SERIA_QA_OVERLAY)
            target.parent.mkdir(parents=True)
            target.write_text("old", encoding="utf-8")
            old_logs = target.parent / "logs"
            old_logs.mkdir()
            (old_logs / "old.log").write_text("old", encoding="utf-8")

            installed = manager.install_archive(
                SERIA_QA_OVERLAY,
                manifest,
                archive,
            )

            self.assertEqual(installed, target)
            self.assertEqual(len(applied), 1)
            self.assertEqual(target.read_bytes(), b"@echo off\r\n")
            self.assertEqual(
                (target.parent / "VERSION").read_text(encoding="utf-8"),
                "2026.9.22\n",
            )
            self.assertTrue((target.parent / "logs" / "old.log").is_file())
            self.assertTrue((target.parent / "logs" / "new.log").is_file())
            self.assertEqual(
                (target.parent / "payload" / "overlay.addon64").read_bytes(),
                b"addon",
            )

            reapplied = manager.apply_installed_package(SERIA_QA_OVERLAY)

            self.assertEqual(reapplied, target)
            self.assertEqual(len(applied), 2)

    def test_installer_failure_keeps_previous_package_and_version(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app_dir = Path(temp_dir)
            archive = app_dir / "SeriaQA.zip"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr(
                    "Seria-QA/Install-SeriaQA.cmd",
                    b"@echo off\r\n",
                )
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            manifest = ModuleManifest.from_dict(
                {
                    "id": "seria-qa-overlay",
                    "version": "2026.9.22",
                    "download_url": "https://example.com/SeriaQA.zip",
                    "sha256": digest,
                    "entrypoint": "Install-SeriaQA.cmd",
                },
                expected_id="seria-qa-overlay",
            )

            def fail_installer(_spec: object, _package_root: Path) -> None:
                raise ModuleUpdateError("game is running")

            manager = ToolModuleManager(
                app_dir,
                package_installer=fail_installer,
            )
            target = manager.executable_path(SERIA_QA_OVERLAY)
            target.parent.mkdir(parents=True)
            target.write_text("old", encoding="utf-8")
            (target.parent / "VERSION").write_text(
                "2026.9.21\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ModuleUpdateError, "game is running"):
                manager.install_archive(
                    SERIA_QA_OVERLAY,
                    manifest,
                    archive,
                )

            self.assertEqual(target.read_text(encoding="utf-8"), "old")
            self.assertEqual(
                (target.parent / "VERSION").read_text(encoding="utf-8"),
                "2026.9.21\n",
            )

    @unittest.skipUnless(os.name == "nt", "Windows installer only")
    def test_default_package_installer_runs_deploy_then_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package_root = Path(temp_dir)
            for name in (
                "Install-SeriaTool.ps1",
                "Publish-Persistent-Recovery.ps1",
                "manifest.json",
            ):
                (package_root / name).write_text("", encoding="utf-8")
            completed = SimpleNamespace(
                returncode=0,
                stdout="",
                stderr="",
            )

            with (
                patch.dict("os.environ", {"SERIA_TRUNK": r"D:\trunk"}),
                patch(
                    "tool_modules.subprocess.run",
                    return_value=completed,
                ) as run,
            ):
                ToolModuleManager._default_package_installer(
                    SERIA_QA_OVERLAY,
                    package_root,
                )

            self.assertEqual(run.call_count, 2)
            install_command = run.call_args_list[0].args[0]
            recovery_command = run.call_args_list[1].args[0]
            self.assertIn("-Yes", install_command)
            self.assertEqual(
                install_command[
                    install_command.index("-TargetPath") + 1
                ],
                r"D:\trunk",
            )
            self.assertNotIn("-Yes", recovery_command)


if __name__ == "__main__":
    unittest.main()
