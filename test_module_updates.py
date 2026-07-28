import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from module_updates import (
    ModuleManifest,
    ModuleUpdateError,
    build_replace_script,
    safe_extract_zip,
    verify_sha256,
    version_key,
)


class ModuleManifestTests(unittest.TestCase):
    def valid_payload(self) -> dict[str, str]:
        return {
            "id": "config-linker",
            "version": "1.1.0",
            "download_url": "https://example.com/ConfigLinker.zip",
            "sha256": "a" * 64,
            "entrypoint": "ConfigLinker.exe",
        }

    def test_valid_manifest_is_parsed(self) -> None:
        manifest = ModuleManifest.from_dict(
            self.valid_payload(),
            expected_id="config-linker",
        )

        self.assertEqual(manifest.module_id, "config-linker")
        self.assertEqual(manifest.version, "1.1.0")
        self.assertEqual(manifest.entrypoint, "ConfigLinker.exe")

    def test_manifest_rejects_wrong_id(self) -> None:
        with self.assertRaisesRegex(ModuleUpdateError, "模块 ID"):
            ModuleManifest.from_dict(
                self.valid_payload(),
                expected_id="kindle-lark-status",
            )

    def test_manifest_rejects_non_https_download(self) -> None:
        payload = self.valid_payload()
        payload["download_url"] = "http://example.com/module.zip"

        with self.assertRaisesRegex(ModuleUpdateError, "HTTPS"):
            ModuleManifest.from_dict(payload, expected_id="config-linker")

    def test_manifest_rejects_invalid_hash(self) -> None:
        payload = self.valid_payload()
        payload["sha256"] = "not-a-hash"

        with self.assertRaisesRegex(ModuleUpdateError, "SHA-256"):
            ModuleManifest.from_dict(payload, expected_id="config-linker")

    def test_manifest_rejects_unsafe_entrypoint(self) -> None:
        payload = self.valid_payload()
        payload["entrypoint"] = "../ConfigLinker.exe"

        with self.assertRaisesRegex(ModuleUpdateError, "入口文件"):
            ModuleManifest.from_dict(payload, expected_id="config-linker")

    def test_version_key_compares_numeric_versions(self) -> None:
        self.assertGreater(version_key("v1.10.0"), version_key("1.2.9"))


class ModuleArchiveTests(unittest.TestCase):
    def test_hash_mismatch_rejects_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "module.zip"
            path.write_bytes(b"payload")

            with self.assertRaisesRegex(ModuleUpdateError, "SHA-256"):
                verify_sha256(path, "0" * 64)

    def test_matching_hash_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "module.zip"
            path.write_bytes(b"payload")
            digest = hashlib.sha256(b"payload").hexdigest()

            verify_sha256(path, digest)

    def test_zip_path_traversal_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            archive = Path(temp_dir) / "unsafe.zip"
            destination = Path(temp_dir) / "extract"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("../outside.exe", b"bad")

            with self.assertRaisesRegex(ModuleUpdateError, "不安全"):
                safe_extract_zip(archive, destination)

            self.assertFalse((Path(temp_dir) / "outside.exe").exists())

    def test_safe_zip_is_extracted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            archive = Path(temp_dir) / "safe.zip"
            destination = Path(temp_dir) / "extract"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("ConfigLinker/ConfigLinker.exe", b"exe")

            safe_extract_zip(archive, destination)

            self.assertEqual(
                (destination / "ConfigLinker" / "ConfigLinker.exe").read_bytes(),
                b"exe",
            )

    def test_replace_script_only_replaces_program_file(self) -> None:
        script = build_replace_script(
            pid_to_wait=123,
            current_exe=Path(r"C:\Tools\ConfigLinker.exe"),
            staged_exe=Path(r"C:\Temp\ConfigLinker.exe"),
            backup_exe=Path(r"C:\Tools\ConfigLinker.exe.bak"),
            restart_exe=Path(r"C:\Tools\ConfigLinker.exe"),
            current_version_file=Path(r"C:\Tools\VERSION"),
            staged_version_file=Path(r"C:\Temp\VERSION"),
        )

        self.assertIn("Get-Process -Id $pidToWait", script)
        self.assertIn("Copy-Item -LiteralPath $stagedExe", script)
        self.assertIn("Copy-Item -LiteralPath $backupExe", script)
        self.assertIn("Copy-Item -LiteralPath $stagedVersionFile", script)
        self.assertIn("Start-Process -FilePath $restartExe", script)
        self.assertNotIn("Copy-Item -Path *", script)
        self.assertNotIn("config_linker_config.json", script)


if __name__ == "__main__":
    unittest.main()
