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
    validate_doc_directory,
)
from tests.fixture_factory import write_fixture


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

    def test_validate_doc_directory_accepts_doc_and_csvdir(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            doc_directory = Path(temp_dir)
            write_fixture(doc_directory / "csvdir")

            selected_doc, missing = validate_doc_directory(doc_directory)
            selected_csv, csv_missing = validate_doc_directory(
                doc_directory / "csvdir"
            )

            self.assertEqual(selected_doc, doc_directory)
            self.assertEqual(selected_csv, doc_directory)
            self.assertEqual(missing, ())
            self.assertEqual(csv_missing, ())

    def test_validate_doc_directory_lists_missing_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            doc_directory = Path(temp_dir)

            selected, missing = validate_doc_directory(doc_directory)

            self.assertIsNone(selected)
            self.assertTrue(any("csvdir" in path for path in missing))

            write_fixture(doc_directory / "csvdir")
            (doc_directory / "csvdir" / "NPC表.csv").unlink()
            selected, missing = validate_doc_directory(doc_directory)
            self.assertIsNone(selected)
            self.assertTrue(any("NPC表.csv" in path for path in missing))


if __name__ == "__main__":
    unittest.main()
