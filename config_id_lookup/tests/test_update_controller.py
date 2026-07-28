import hashlib
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from config_linker.update_controller import (
    ConfigLinkerUpdateController,
    ModuleManifest,
    ModuleUpdateError,
)


class UpdateControllerTests(unittest.TestCase):
    def _manifest(
        self,
        *,
        version: str = "1.1.0",
        sha256: str = "a" * 64,
    ) -> ModuleManifest:
        return ModuleManifest.from_dict(
            {
                "id": "config-linker",
                "version": version,
                "download_url": "https://example.com/ConfigLinker.zip",
                "sha256": sha256,
                "entrypoint": "ConfigLinker.exe",
            },
            expected_id="config-linker",
        )

    def test_older_local_version_reports_ready(self) -> None:
        manifest = self._manifest(version="1.1.0")
        controller = ConfigLinkerUpdateController(
            local_version="1.0.0",
            current_exe=Path("ConfigLinker.exe"),
            work_dir=Path("_updates"),
            manifest_fetcher=lambda _url, _module_id: manifest,
        )

        result = controller.check()

        self.assertEqual(result.state, "ready")
        self.assertIs(result.manifest, manifest)

    def test_matching_version_reports_idle(self) -> None:
        manifest = self._manifest(version="1.1.0")
        controller = ConfigLinkerUpdateController(
            local_version="1.1.0",
            current_exe=Path("ConfigLinker.exe"),
            work_dir=Path("_updates"),
            manifest_fetcher=lambda _url, _module_id: manifest,
        )

        result = controller.check()

        self.assertEqual(result.state, "idle")
        self.assertIsNone(result.manifest)

    def test_network_failure_reports_failed(self) -> None:
        def fail(_url: str, _module_id: str) -> ModuleManifest:
            raise OSError("offline")

        controller = ConfigLinkerUpdateController(
            local_version="1.1.0",
            current_exe=Path("ConfigLinker.exe"),
            work_dir=Path("_updates"),
            manifest_fetcher=fail,
        )

        result = controller.check()

        self.assertEqual(result.state, "failed")
        self.assertIn("offline", result.message)

    def test_prepare_downloads_verifies_and_builds_replace_script(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_archive = root / "source.zip"
            with zipfile.ZipFile(source_archive, "w") as handle:
                handle.writestr("ConfigLinker/ConfigLinker.exe", b"new-exe")
            digest = hashlib.sha256(source_archive.read_bytes()).hexdigest()
            manifest = self._manifest(sha256=digest)
            current_exe = root / "installed" / "ConfigLinker.exe"
            current_exe.parent.mkdir()
            current_exe.write_bytes(b"old-exe")

            def downloader(_url: str, destination: Path) -> None:
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_archive, destination)

            controller = ConfigLinkerUpdateController(
                local_version="1.0.0",
                current_exe=current_exe,
                work_dir=root / "updates",
                archive_downloader=downloader,
                pid_provider=lambda: 4321,
            )

            prepared = controller.prepare_update(manifest)
            script = prepared.script_path.read_text(encoding="utf-8")

            self.assertEqual(prepared.version, "1.1.0")
            self.assertEqual(prepared.staged_exe.read_bytes(), b"new-exe")
            self.assertIn("$pidToWait = 4321", script)
            self.assertIn(str(current_exe), script)
            self.assertEqual(
                prepared.staged_version.read_text(encoding="utf-8"),
                "1.1.0\n",
            )

    def test_hash_failure_removes_downloaded_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            current_exe = root / "ConfigLinker.exe"
            current_exe.write_bytes(b"old-exe")

            def downloader(_url: str, destination: Path) -> None:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b"invalid-archive")

            controller = ConfigLinkerUpdateController(
                local_version="1.0.0",
                current_exe=current_exe,
                work_dir=root / "updates",
                archive_downloader=downloader,
            )

            with self.assertRaises(ModuleUpdateError):
                controller.prepare_update(self._manifest())

            self.assertFalse(
                (root / "updates" / "ConfigLinker.zip").exists()
            )


if __name__ == "__main__":
    unittest.main()
