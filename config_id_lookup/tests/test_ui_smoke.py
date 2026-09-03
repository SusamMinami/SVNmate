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
from config_linker.weapon_icon_catalog import WeaponIconAsset
from tests.fixture_factory import write_fixture, write_weapon_fixture


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


class FakeWeaponIconService:
    def __init__(self, image_path: Path) -> None:
        self.image_path = image_path
        self.cache = SimpleNamespace(count=lambda: 1)

    def index_is_fresh(self) -> bool:
        return True

    def asset_for_icon(
        self,
        icon_id: int | None,
    ) -> WeaponIconAsset | None:
        if icon_id != 201572:
            return None
        return WeaponIconAsset(
            icon_id=icon_id,
            record_id="rec_weapon_icon",
            file_token="weapon-icon-token",
            file_name=self.image_path.name,
        )

    def asset_path(
        self,
        asset: WeaponIconAsset | None,
    ) -> Path | None:
        return self.image_path if asset is not None else None

    def ensure_icon(self, icon_id: int) -> Path | None:
        return self.image_path if icon_id == 201572 else None


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
            self.assertEqual(len(app.workspace_tabs.tabs()), 2)
            self.assertEqual(
                [button.cget("text") for button in app.workspace_buttons.values()],
                ["角色查询", "武器查询"],
            )
            self.assertEqual(
                str(app.workspace_tabs.cget("style")),
                "Workspace.TNotebook",
            )
            self.assertEqual(str(app.back_button.cget("state")), "disabled")
            self.assertEqual(str(app.settings_button.cget("text")), "⚙")
            self.assertEqual(str(app.reload_button.cget("text")), "↻")
            self.assertEqual(str(app.back_button.cget("text")), "←")
            self.assertTrue(
                all(
                    str(button.cget("style")) == "Icon.TButton"
                    for button in (
                        app.settings_button,
                        app.reload_button,
                        app.back_button,
                    )
                )
            )
            self.assertEqual(
                [tooltip.text for tooltip in app.icon_tooltips],
                ["设置", "重新加载", "返回上一步"],
            )
            self.assertEqual(
                [
                    app.settings_menu.entrycget(index, "label")
                    for index in range(3)
                ],
                ["选择 doc 目录", "复制诊断信息", "同步角色档案"],
            )
            self.assertEqual(app.version_text.get(), "v1.5.3")
        finally:
            root.destroy()

    def test_weapon_tab_loads_searches_and_renders_relations(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            from PIL import Image

            doc_directory = Path(temp_dir)
            write_fixture(doc_directory / "csvdir")
            write_weapon_fixture(doc_directory)
            weapon_icon_path = doc_directory / "weapon_icon_201572.png"
            Image.new("RGBA", (256, 256), "#D38A28").save(weapon_icon_path)
            root = Tk()
            root.withdraw()
            try:
                app = ConfigLinkerApp(
                    root,
                    config_path=doc_directory / "settings.json",
                    auto_load=False,
                    weapon_icon_service=FakeWeaponIconService(
                        weapon_icon_path
                    ),
                )
                app.settings = AppSettings(doc_directory)
                app.reload_data()
                app._select_workspace(1)
                app.weapon_frame.query_text.set("700501")
                app.weapon_frame.search()
                root.update_idletasks()

                result_items = app.weapon_frame.result_tree.get_children()
                self.assertEqual(len(result_items), 1)
                self.assertEqual(
                    int(
                        app.weapon_frame.result_tree.item(
                            result_items[0],
                            "values",
                        )[0]
                    ),
                    700501,
                )
                self.assertEqual(
                    app.weapon_frame.selected_name_text.get(),
                    "真·黑光星陨剑",
                )
                self.assertIn(
                    "魔剑士",
                    app.weapon_frame.selected_meta_text.get(),
                )
                self.assertEqual(
                    len(
                        app.weapon_frame.relation_trees[
                            "same_group"
                        ].get_children()
                    ),
                    1,
                )
                self.assertEqual(
                    app.weapon_frame.relation_button_texts[
                        "same_group"
                    ].get(),
                    "同类武器 1",
                )
                self.assertEqual(
                    app.weapon_frame.model_name_text.get(),
                    "SK_Rapier",
                )
                self.assertEqual(
                    app.weapon_frame.selected_description_text.get(),
                    "在星陨中淬炼而成的魔剑。",
                )
                self.assertEqual(
                    app.weapon_frame.description_text.get("1.0", "end-1c"),
                    "在星陨中淬炼而成的魔剑。",
                )
                self.assertEqual(
                    str(app.weapon_frame.description_text.cget("state")),
                    "disabled",
                )
                self.assertEqual(
                    app.weapon_frame.weapon_icon_view.icon_id,
                    201572,
                )
                self.assertEqual(
                    app.weapon_frame.weapon_icon_view.image_path,
                    weapon_icon_path,
                )
                self.assertIsNotNone(
                    app.weapon_frame.weapon_icon_view._photo
                )
                self.assertEqual(
                    app.weapon_frame.weapon_icon_view.tooltip.text,
                    "武器图标 ID：201572",
                )
                self.assertTrue(
                    app.weapon_frame.description_text.bind("<Control-a>")
                )
                self.assertIn("武器 4", app.status_text.get())
                self.assertEqual(
                    app.weapon_frame.description_text.master.grid_info()["row"],
                    1,
                )
                self.assertEqual(
                    app.weapon_frame.relation_tabs.cget("style"),
                    "Workspace.TNotebook",
                )
                self.assertEqual(
                    {
                        int(button.cget("width"))
                        for button in app.weapon_frame.relation_buttons.values()
                    },
                    {13},
                )
                relation_positions = [
                    button.winfo_x()
                    for button in app.weapon_frame.relation_buttons.values()
                ]
                app.weapon_frame._select_relation(1)
                root.update_idletasks()
                self.assertEqual(
                    [
                        button.winfo_x()
                        for button in app.weapon_frame.relation_buttons.values()
                    ],
                    relation_positions,
                )
            finally:
                root.destroy()

    def test_header_workspace_buttons_switch_content(self) -> None:
        root = Tk()
        root.withdraw()
        try:
            app = ConfigLinkerApp(
                root,
                config_path=Path("__missing_config_for_test__.json"),
                auto_load=False,
            )
            root.update_idletasks()
            positions_before = [
                button.winfo_x()
                for button in app.workspace_buttons.values()
            ]

            app._select_workspace(1)
            root.update_idletasks()

            self.assertEqual(
                app.workspace_tabs.select(),
                str(app.weapon_frame),
            )
            self.assertEqual(
                str(app.workspace_buttons[1].cget("style")),
                "SegmentActive.TButton",
            )
            self.assertEqual(
                str(app.workspace_buttons[0].cget("style")),
                "Segment.TButton",
            )
            self.assertEqual(
                int(app.workspace_buttons[0].cget("width")),
                int(app.workspace_buttons[1].cget("width")),
            )
            self.assertEqual(
                [
                    button.winfo_x()
                    for button in app.workspace_buttons.values()
                ],
                positions_before,
            )
            self.assertEqual(app.role_query_controls.winfo_manager(), "")
            self.assertEqual(
                app.weapon_query_controls.winfo_manager(),
                "pack",
            )
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
