import os
import tempfile
import unittest
from pathlib import Path
from tkinter import Tk

from config_linker.models import NpcRecord, QueryKey, QueryKind, TargetRecord
from config_linker.settings import AppSettings
from config_linker.ui import ConfigLinkerApp
from tests.fixture_factory import write_fixture


@unittest.skipUnless(os.name == "nt", "Windows Tk smoke test")
class UiSmokeTests(unittest.TestCase):
    def test_window_builds_without_loading_real_data(self) -> None:
        root = Tk()
        root.withdraw()
        try:
            app = ConfigLinkerApp(
                root,
                config_path=Path("__missing_config_for_test__.json"),
                auto_load=False,
            )
            root.update_idletasks()

            self.assertEqual(root.title(), "配置关系检索器")
            self.assertEqual(len(app.result_trees), 3)
            self.assertEqual(str(app.back_button.cget("state")), "disabled")
        finally:
            root.destroy()

    def test_relation_id_cells_build_the_expected_query_keys(self) -> None:
        target = TargetRecord(1001, "交互物", "目标", 2001, 3)
        npc = NpcRecord(2001, "备注", "NPC", 3001, 3)

        self.assertEqual(
            ConfigLinkerApp._query_key_for_cell(QueryKind.TARGET, target, "#4"),
            QueryKey(QueryKind.NPC, 2001),
        )
        self.assertEqual(
            ConfigLinkerApp._query_key_for_cell(QueryKind.NPC, npc, "#4"),
            QueryKey(QueryKind.RESOURCE, 3001),
        )

    def test_failed_refresh_keeps_the_last_successful_repository(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            write_fixture(directory)
            root = Tk()
            root.withdraw()
            try:
                app = ConfigLinkerApp(
                    root,
                    config_path=directory / "settings.json",
                    auto_load=False,
                )
                app.settings = AppSettings(directory)
                app.reload_data()
                loaded_repository = app.repository
                (directory / "NPC表.csv").unlink()

                app.reload_data()

                self.assertIs(app.repository, loaded_repository)
                self.assertIn("仍使用旧数据", app.status_text.get())
                app.visit_query(QueryKey(QueryKind.TARGET, 1001))
                self.assertEqual(app.current_result.key.value, 1001)
            finally:
                root.destroy()


if __name__ == "__main__":
    unittest.main()
