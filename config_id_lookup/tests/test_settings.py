import tempfile
import unittest
from pathlib import Path

from config_linker.settings import (
    DEFAULT_DATA_DIRECTORY,
    AppSettings,
    load_settings,
    save_settings,
)


class SettingsTests(unittest.TestCase):
    def test_missing_file_uses_main_csvdir(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "settings.json"

            settings, warning = load_settings(path)

            self.assertEqual(settings.data_directory, DEFAULT_DATA_DIRECTORY)
            self.assertIsNone(warning)

    def test_saved_directory_round_trips(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "settings.json"
            expected = AppSettings(Path(r"D:\other\csvdir"))

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

            self.assertEqual(settings.data_directory, DEFAULT_DATA_DIRECTORY)
            self.assertIn("配置文件", warning or "")
            self.assertEqual(path.read_text(encoding="utf-8"), malformed)

    def test_missing_data_directory_key_returns_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "settings.json"
            path.write_text('{"other": 1}', encoding="utf-8")

            settings, warning = load_settings(path)

            self.assertEqual(settings.data_directory, DEFAULT_DATA_DIRECTORY)
            self.assertIn("data_directory", warning or "")


if __name__ == "__main__":
    unittest.main()
