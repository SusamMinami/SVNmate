import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from module_updates import ModuleManifest
from tool_modules import (
    CONFIG_LINKER,
    KINDLE_STATUS,
    MIGRATION_GUARD,
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
            configured = app_dir / "external" / "KindleLarkStatus.exe"
            self.assertEqual(
                manager.executable_path(KINDLE_STATUS, configured),
                configured,
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


if __name__ == "__main__":
    unittest.main()
