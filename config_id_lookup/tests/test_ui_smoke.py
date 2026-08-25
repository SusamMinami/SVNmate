import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tkinter import Tk
from types import SimpleNamespace
from unittest.mock import patch

from config_linker.character_catalog import (
    CharacterDetails,
    CharacterDialogue,
    CharacterProfile,
    CharacterStory,
    CharacterTask,
    CharacterVisualAsset,
    CharacterVisuals,
)
from config_linker.models import NpcRecord, QueryKey, QueryKind, ResourceRecord, TargetRecord
from config_linker.settings import AppSettings
from config_linker.ui import CARD_COLUMNS, ConfigLinkerApp
from tests.fixture_factory import write_fixture


class FakeCharacterService:
    def __init__(
        self,
        visuals: CharacterVisuals | None = None,
        visual_paths: dict[str, Path] | None = None,
    ) -> None:
        self.cache = SimpleNamespace(profile_count=lambda: 1)
        self.visuals = visuals or CharacterVisuals()
        self.visual_paths = visual_paths or {}
        self.profile = CharacterProfile(
            record_id="rec_role",
            role_key="named:测试NPC甲",
            name="测试NPC甲",
            tags=("冷静", "谨慎"),
            summary="角色摘要",
            personality="性格分析",
            story="故事经历",
            evidence_level="中（3-19句）",
            analysis_status="已生成",
            dialogue_count=1,
        )

    def index_is_fresh(self) -> bool:
        return True

    def profile_for_npc(self, npc_id: int) -> CharacterProfile | None:
        return self.profile if npc_id == 2001 else None

    def npc_ids_for_character(self, character_id: str) -> tuple[int, ...]:
        return (2001,) if character_id == self.profile.record_id else ()

    def visuals_for_npc(self, npc_id: int) -> CharacterVisuals:
        return self.visuals if npc_id == 2001 else CharacterVisuals()

    def asset_path(self, asset: CharacterVisualAsset | None) -> Path | None:
        return self.visual_paths.get(asset.kind) if asset is not None else None

    def ensure_visuals(self, npc_id: int) -> CharacterVisuals:
        return self.visuals_for_npc(npc_id)


class FakeCharacterContentRepository:
    def __init__(self) -> None:
        self.directory = Path(r"C:\test\doc\csvdir")
        self.report = SimpleNamespace(
            dialogue_count=1,
            story_count=1,
            task_count=1,
        )
        self.details = CharacterDetails(
            character_id="rec_role",
            tasks=(CharacterTask("1000", "第一章主线", "任务简介", "100"),),
            dialogues=(CharacterDialogue("100101", "1001", "测试台词"),),
            stories=(CharacterStory("1001", "100100", "剧情简介"),),
            loaded_at=datetime.now(timezone.utc),
        )

    def details_for_character(
        self,
        character_id: str,
        npc_ids: tuple[int, ...],
    ) -> CharacterDetails:
        del npc_ids
        if character_id != self.details.character_id:
            raise LookupError(character_id)
        return self.details


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
            self.assertEqual(
                str(app.choose_doc_button.cget("text")),
                "选择 doc 目录",
            )
            self.assertEqual(app.version_text.get(), "v1.4.0")
        finally:
            root.destroy()

    def test_declining_update_does_not_prepare_download(self) -> None:
        class FakeUpdateController:
            def __init__(self) -> None:
                self.prepare_calls = 0

            def prepare_update(self, _manifest: object) -> None:
                self.prepare_calls += 1

        root = Tk()
        root.withdraw()
        try:
            controller = FakeUpdateController()
            app = ConfigLinkerApp(
                root,
                config_path=Path("__missing_config_for_test__.json"),
                auto_load=False,
                app_version="1.3.1",
                update_controller=controller,
            )
            app.update_state = "ready"
            app.update_manifest = SimpleNamespace(version="1.3.1")

            with patch(
                "config_linker.ui.messagebox.askyesno",
                return_value=False,
            ):
                app._on_update_dot_clicked()

            self.assertEqual(controller.prepare_calls, 0)
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

    def test_resource_card_has_horizontal_scroll_and_readonly_path_detail(self) -> None:
        root = Tk()
        root.withdraw()
        try:
            app = ConfigLinkerApp(
                root,
                config_path=Path("__missing_config_for_test__.json"),
                auto_load=False,
            )
            root.update_idletasks()

            self.assertEqual(
                [column[0] for column in CARD_COLUMNS[QueryKind.RESOURCE]],
                ["id", "configured_path"],
            )
            self.assertIn(QueryKind.RESOURCE, app.horizontal_scrollbars)
            self.assertTrue(
                str(app.result_trees[QueryKind.RESOURCE].cget("xscrollcommand"))
            )
            self.assertEqual(str(app.resource_path_entry.cget("state")), "readonly")

            app._show_record_detail(ResourceRecord(3001, "/Game/Test/BP_Test", 3))
            self.assertEqual(app.resource_path_text.get(), "/Game/Test/BP_Test")
        finally:
            root.destroy()

    def test_failed_refresh_keeps_the_last_successful_repository(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            doc_directory = Path(temp_dir)
            csv_directory = doc_directory / "csvdir"
            write_fixture(csv_directory)
            root = Tk()
            root.withdraw()
            try:
                app = ConfigLinkerApp(
                    root,
                    config_path=doc_directory / "settings.json",
                    auto_load=False,
                )
                app.settings = AppSettings(doc_directory)
                app.reload_data()
                loaded_repository = app.repository
                (csv_directory / "NPC表.csv").unlink()

                app.reload_data()

                self.assertIs(app.repository, loaded_repository)
                self.assertIn("仍使用旧数据", app.status_text.get())
                app.visit_query(QueryKey(QueryKind.TARGET, 1001))
                self.assertEqual(app.current_result.key.value, 1001)
            finally:
                root.destroy()

    def test_npc_name_query_populates_the_middle_result_card(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            doc_directory = Path(temp_dir)
            write_fixture(doc_directory / "csvdir")
            root = Tk()
            root.withdraw()
            try:
                app = ConfigLinkerApp(
                    root,
                    config_path=doc_directory / "settings.json",
                    auto_load=False,
                )
                app.settings = AppSettings(doc_directory)
                app.reload_data()
                app.query_type.set("NPC 名称")
                app.query_value.set("npc甲")

                app.search_from_input()
                root.update_idletasks()

                self.assertEqual(
                    app.current_result.key,
                    QueryKey(QueryKind.NPC_NAME, "npc甲"),
                )
                self.assertEqual(app.query_type.get(), "NPC 名称")
                self.assertEqual(app.query_value.get(), "npc甲")
                npc_tree = app.result_trees[QueryKind.NPC]
                npc_items = npc_tree.get_children()
                self.assertEqual(
                    [int(npc_tree.item(item, "values")[0]) for item in npc_items],
                    [2001],
                )
                self.assertTrue(
                    all(
                        "focus" in npc_tree.item(item, "tags")
                        for item in npc_items
                    )
                )
                self.assertIn(
                    "名称“npc甲”",
                    app.card_focus[QueryKind.NPC].get(),
                )
            finally:
                root.destroy()

    def test_focus_copy_toast_and_visible_target_location_details(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            doc_directory = Path(temp_dir)
            write_fixture(doc_directory / "csvdir")
            root = Tk()
            root.withdraw()
            try:
                app = ConfigLinkerApp(
                    root,
                    config_path=doc_directory / "settings.json",
                    auto_load=False,
                )
                app.settings = AppSettings(doc_directory)
                app.reload_data()
                app.visit_query(QueryKey(QueryKind.TARGET, 1001))
                root.update_idletasks()

                self.assertIn("1001", app.card_focus[QueryKind.TARGET].get())
                focus_items = [
                    item
                    for item in app.result_trees[QueryKind.TARGET].get_children()
                    if "focus" in app.result_trees[QueryKind.TARGET].item(item, "tags")
                ]
                self.assertTrue(focus_items)

                target = app.repository.targets_by_id[1001][0]
                app._show_record_detail(target)
                self.assertEqual(app.target_position_text.get(), "(X=1,Y=2,Z=3)")
                self.assertEqual(
                    app.target_rotation_text.get(),
                    "(Pitch=0,Yaw=90,Roll=0)",
                )
                self.assertEqual(app.target_detail_frame.winfo_manager(), "pack")
                self.assertEqual(str(app.target_position_entry.cget("state")), "readonly")
                self.assertEqual(str(app.target_rotation_entry.cget("state")), "readonly")
                self.assertEqual(app.target_position_entry.grid_info()["row"], 0)
                self.assertEqual(app.target_rotation_entry.grid_info()["row"], 0)
                self.assertEqual(app.target_position_entry.grid_info()["column"], 1)
                self.assertEqual(app.target_rotation_entry.grid_info()["column"], 3)

                app._copy_text("1001", "目标物 ID 1001")
                self.assertEqual(root.clipboard_get(), "1001")
                self.assertEqual(app.toast_text.get(), "已复制 目标物 ID 1001")
            finally:
                root.destroy()

    def test_character_button_only_appears_for_named_profile(self) -> None:
        root = Tk()
        root.withdraw()
        try:
            app = ConfigLinkerApp(
                root,
                config_path=Path("__missing_config_for_test__.json"),
                auto_load=False,
                character_service=FakeCharacterService(),
                character_content_repository=FakeCharacterContentRepository(),
                auto_refresh_characters=False,
            )
            app._show_record_detail(
                NpcRecord(2001, "主线角色", "测试NPC甲", 3001, 3)
            )
            self.assertEqual(
                app.character_detail_button.winfo_manager(),
                "pack",
            )

            app._show_record_detail(
                NpcRecord(2002, "通用角色", "测试NPC乙", 3001, 4)
            )
            self.assertEqual(
                app.character_detail_button.winfo_manager(),
                "",
            )
        finally:
            root.destroy()

    def test_character_window_is_role_focused_and_has_three_tabs(self) -> None:
        root = Tk()
        root.withdraw()
        try:
            app = ConfigLinkerApp(
                root,
                config_path=Path("__missing_config_for_test__.json"),
                auto_load=False,
                character_service=FakeCharacterService(),
                character_content_repository=FakeCharacterContentRepository(),
                auto_refresh_characters=False,
            )
            app._show_record_detail(
                NpcRecord(2001, "主线角色", "测试NPC甲", 3001, 3)
            )
            app._open_character_detail()
            root.update_idletasks()

            window = app.character_window
            self.assertIsNotNone(window)
            self.assertEqual(window.window.title(), "测试NPC甲 · 角色档案")
            self.assertEqual(
                set(window.tab_buttons),
                {"tasks", "dialogues", "stories"},
            )
            self.assertNotIn("2001", window.portrait_banner.meta)
            self.assertNotIn("3001", window.portrait_banner.meta)
        finally:
            root.destroy()

    def test_character_visuals_show_ids_and_portrait_background(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            from PIL import Image

            directory = Path(temp_dir)
            avatar_path = directory / "avatar.png"
            portrait_path = directory / "portrait.png"
            Image.new("RGBA", (84, 84), "#4B78C2").save(avatar_path)
            Image.new("RGBA", (512, 100), "#7A8798").save(portrait_path)
            visuals = CharacterVisuals(
                avatar=CharacterVisualAsset(
                    "avatar",
                    "16",
                    "rec_avatar",
                    "avatar-token",
                    "avatar.png",
                ),
                portrait=CharacterVisualAsset(
                    "portrait",
                    "100",
                    "rec_portrait",
                    "portrait-token",
                    "portrait.png",
                ),
            )
            service = FakeCharacterService(
                visuals,
                {
                    "avatar": avatar_path,
                    "portrait": portrait_path,
                },
            )
            root = Tk()
            root.withdraw()
            try:
                app = ConfigLinkerApp(
                    root,
                    config_path=Path("__missing_config_for_test__.json"),
                    auto_load=False,
                    character_service=service,
                    character_content_repository=FakeCharacterContentRepository(),
                    auto_refresh_characters=False,
                )
                app._show_record_detail(
                    NpcRecord(2001, "主线角色", "测试NPC甲", 3001, 3)
                )
                root.update_idletasks()

                self.assertEqual(
                    app.character_avatar.winfo_manager(),
                    "pack",
                )
                self.assertEqual(
                    app.character_avatar.tooltip.text,
                    "头像 ID：16",
                )

                app._open_character_detail()
                root.update_idletasks()
                window = app.character_window
                self.assertIsNotNone(window)
                self.assertEqual(
                    window.portrait_banner.tooltip.text,
                    "立绘 ID：100",
                )
                self.assertIsNotNone(window.portrait_banner._source_image)
            finally:
                root.destroy()


if __name__ == "__main__":
    unittest.main()
