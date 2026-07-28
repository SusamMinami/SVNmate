import tempfile
import unittest
from pathlib import Path

from config_linker.settings import (
    DEFAULT_DOC_DIRECTORY,
    AppSettings,
    csv_directory,
    load_settings,
    normalize_doc_directory,
    save_settings,
)


class SettingsTests(unittest.TestCase):
    def test_missing_file_uses_main_doc_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "settings.json"

            settings, warning = load_settings(path)

            self.assertEqual(settings.doc_directory, DEFAULT_DOC_DIRECTORY)
            self.assertEqual(
                csv_directory(settings),
                DEFAULT_DOC_DIRECTORY / "csvdir",
            )
            self.assertIsNone(warning)

    def test_saved_directory_round_trips(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "settings.json"
            expected = AppSettings(Path(r"D:\other\doc"))

            save_settings(path, expected)
            actual, warning = load_settings(path)

            self.assertEqual(actual, expected)
            self.assertIsNone(warning)

    def test_malformed_json_falls_back_without_rewriting_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "settings.json"
            malformed = "{not-json"
            path.write_text(malformed, encoding="utf-8")

            settings, warning = load_settings(path)

            self.assertEqual(settings.doc_directory, DEFAULT_DOC_DIRECTORY)
            self.assertIn("配置文件", warning or "")
            self.assertEqual(path.read_text(encoding="utf-8"), malformed)

    def test_missing_doc_directory_key_returns_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "settings.json"
            path.write_text('{"other": 1}', encoding="utf-8")

            settings, warning = load_settings(path)

            self.assertEqual(settings.doc_directory, DEFAULT_DOC_DIRECTORY)
            self.assertIn("doc_directory", warning or "")

    def test_legacy_csvdir_setting_migrates_to_doc_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "settings.json"
            path.write_text(
                '{"data_directory": "D:\\\\workspace\\\\doc\\\\csvdir"}',
                encoding="utf-8",
            )

            settings, warning = load_settings(path)

            self.assertEqual(settings.doc_directory, Path(r"D:\workspace\doc"))
            self.assertIsNone(warning)

    def test_selected_csvdir_is_normalized_to_parent_doc(self) -> None:
        selected = Path(r"D:\workspace\doc\csvdir")

        self.assertEqual(
            normalize_doc_directory(selected),
            Path(r"D:\workspace\doc"),
        )


if __name__ == "__main__":
    unittest.main()
