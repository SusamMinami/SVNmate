import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from migration_guard.config import (
    WORKSPACE_DOMESTIC,
    WORKSPACE_OVERSEAS_TRUNK,
    MigrationGuardConfig,
    load_config,
    save_config,
)


def _destroy_root(root) -> None:
    for callback in root.tk.call("after", "info"):
        try:
            root.after_cancel(callback)
        except Exception:
            pass
    root.destroy()


def _walk_widgets(widget):
    for child in widget.winfo_children():
        yield child
        yield from _walk_widgets(child)


class MigrationGuardConfigTests(unittest.TestCase):
    def test_config_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "config.json"
            expected = MigrationGuardConfig(
                domestic_root=r"C:\source",
                overseas_trunk_root=r"D:\target",
                overseas_ob_root=r"D:\ob",
                source_workspace=WORKSPACE_DOMESTIC,
                enabled_modules=("res", "doc"),
                lookback_days=45,
                remote_refresh_minutes=2,
                include_externals=False,
                trunk_sheet_url=(
                    "https://example.invalid/wiki/trunk"
                ),
                osob_sheet_url=(
                    "https://example.invalid/wiki/token?sheet=sheet-1"
                ),
            )

            save_config(expected, path)
            actual = load_config(path)

        self.assertEqual(actual, expected)

    def test_invalid_config_uses_safe_defaults(self) -> None:
        config = MigrationGuardConfig.from_dict(
            {
                "enabled_modules": "res",
                "lookback_days": "invalid",
                "remote_refresh_minutes": 3,
            }
        )

        self.assertEqual(config.enabled_modules, ())
        self.assertEqual(config.lookback_days, 90)
        self.assertEqual(config.remote_refresh_minutes, 2)

    def test_legacy_config_is_upgraded_to_three_workspaces(self) -> None:
        config = MigrationGuardConfig.from_dict(
            {
                "source_root": r"D:\Oversea\OStrunk",
                "target_root": r"D:\Oversea\OSOB",
                "ticket_sheet_url": "https://example.invalid/wiki/legacy",
            }
        )

        self.assertEqual(
            config.source_workspace,
            WORKSPACE_OVERSEAS_TRUNK,
        )
        self.assertEqual(
            config.overseas_trunk_root,
            r"D:\Oversea\OStrunk",
        )
        self.assertEqual(config.overseas_ob_root, r"D:\Oversea\OSOB")
        self.assertEqual(
            config.trunk_sheet_url,
            "https://example.invalid/wiki/legacy",
        )
        self.assertEqual(config.osob_sheet_url, config.trunk_sheet_url)


@unittest.skipUnless(os.name == "nt", "Windows desktop UI only")
class MigrationGuardUiSmokeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.save_config_patcher = patch(
            "migration_guard.app.save_config"
        )
        self.save_config_patcher.start()

    def tearDown(self) -> None:
        self.save_config_patcher.stop()

    def test_main_window_builds(self) -> None:
        from tkinter import Tk, font as tkfont, ttk

        from migration_guard.app import APP_ICON_PATH, MigrationGuardApp

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
                root.update_idletasks()

            self.assertEqual(root.title(), "迁移核验助手")
            expected_width = min(
                1360,
                max(920, root.winfo_screenwidth() - 40),
            )
            self.assertTrue(
                root.geometry().startswith(f"{expected_width}x")
            )
            self.assertEqual(app.ui_font_family, "Microsoft YaHei UI")
            self.assertEqual(
                tkfont.nametofont(
                    "TkDefaultFont",
                    root=root,
                ).actual("family"),
                app.ui_font_family,
            )
            self.assertEqual(
                tkfont.Font(
                    root=root,
                    font=app.detail.cget("font"),
                ).actual("family"),
                app.ui_font_family,
            )
            self.assertGreaterEqual(
                int(ttk.Style(root).lookup("Treeview", "rowheight")),
                app.type_fonts["body"].metrics("linespace") + 6,
            )
            self.assertEqual(APP_ICON_PATH.name, "migration_guard.ico")
            self.assertTrue(APP_ICON_PATH.is_file())
            self.assertEqual(
                app.trunk_table_button.cget("text"),
                "合海外 Trunk",
            )
            self.assertEqual(
                app.osob_table_button.cget("text"),
                "合海外 Trunk-OB",
            )
            labels = {
                str(widget.cget("text"))
                for widget in _walk_widgets(root)
                if isinstance(widget, ttk.Label)
            }
            self.assertNotIn("源单号", labels)
            self.assertNotIn("海外目标", labels)
            self.assertIs(
                app.workflow_progress_bar.master.master,
                app.detail_filter_button.master,
            )
            self.assertTrue(
                all(
                    button.master is app.summary_bar
                    for button in app.result_view_buttons
                )
            )
            self.assertEqual(
                int(app.table.grid_info()["row"]),
                0,
            )
            self.assertEqual(
                app.resolve_button.cget("style"),
                "Primary.TButton",
            )
            self.assertEqual(
                str(app.update_button.cget("state")),
                "disabled",
            )
            self.assertFalse(hasattr(app, "action_menu_button"))
            self.assertEqual(app.last_refresh_text.get(), "尚未刷新")
            self.assertTrue(app.table.bind("<Motion>"))
            app._set_summary_counts(
                12,
                {
                    "pending_commit": 2,
                    "complete": 10,
                },
            )
            self.assertEqual(
                app.summary_button_text["all"].get(),
                "全部 12",
            )
            self.assertEqual(
                app.summary_button_text["pending_all"].get(),
                "待处理 2",
            )
            self.assertFalse(app.use_ticket_button.winfo_manager())
            app._configure_audit_table()
            self.assertEqual(
                str(app.table.column("path", "anchor")),
                "e",
            )
            self.assertEqual(
                tuple(app.table["columns"]),
                ("state", "module", "path", "source", "local", "target"),
            )
        finally:
            _destroy_root(root)

    def test_settings_group_related_fields_and_support_escape(self) -> None:
        from tkinter import Tk, ttk

        from migration_guard.app import MigrationGuardApp

        root = Tk()
        root.withdraw()
        root.tk.call("tk", "scaling", 2.0)
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            app._configure_ticket_sheet()
            root.update_idletasks()
            window = app.settings_window
            self.assertIsNotNone(window)
            labels = {
                str(widget.cget("text"))
                for widget in _walk_widgets(window)
                if isinstance(widget, ttk.Label)
            }
            self.assertTrue(
                {"工作区", "固定表", "核验策略"}.issubset(labels)
            )
            entries = [
                widget
                for widget in _walk_widgets(window)
                if widget.winfo_class() == "TEntry"
            ]
            self.assertEqual(len(entries), 5)
            self.assertEqual(window.grab_current(), window)
            self.assertLessEqual(window.winfo_reqwidth(), 940)
            self.assertLessEqual(window.winfo_reqheight(), 470)

            self.assertTrue(window.bind("<Escape>"))
            window.destroy()
            app.settings_window = None
        finally:
            _destroy_root(root)

    def test_pm_update_refreshes_remote_state_without_workspaces(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.ticket_mapping import TicketMapping, TicketRoute

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(
                    remote_refresh_minutes=2,
                ),
            ):
                app = MigrationGuardApp(root)
            mapping = TicketMapping(
                "SERIA-10",
                "OSCOA-20",
                TicketRoute.DOMESTIC_TO_OVERSEAS,
                1,
                "source",
                "target",
                "raw",
            )
            app.current_ticket_mappings = (mapping,)
            app.source_issue.set("SERIA-10")
            app.target_issue.set("OSCOA-20")
            app.source_root.set(r"Z:\missing-source")
            app.target_root.set(r"Z:\missing-target")

            with (
                patch.object(app, "_start_jira_progress") as refresh,
                patch.object(app, "_start_batch_background") as audit,
            ):
                app._start_update_and_audit()

            refresh.assert_called_once_with(
                (mapping,),
                force_refresh=True,
            )
            audit.assert_not_called()
            app._schedule_remote_auto_refresh()
            self.assertIsNotNone(app._remote_refresh_after_id)
        finally:
            _destroy_root(root)

    def test_workspace_menu_is_anchored_to_name_button(self) -> None:
        from migration_guard.app import MigrationGuardApp

        menu = Mock()
        anchor = Mock()
        anchor.winfo_rootx.return_value = 120
        anchor.winfo_rooty.return_value = 40
        anchor.winfo_height.return_value = 32

        MigrationGuardApp._show_workspace_menu(menu, anchor)

        menu.tk_popup.assert_called_once_with(120, 72)
        menu.grab_release.assert_called_once_with()

    def test_route_name_and_arrow_open_the_same_selector(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)

            with patch.object(app, "_show_workspace_menu") as popup:
                app.route_button.invoke()
                app.route_menu_button.invoke()

            self.assertEqual(popup.call_count, 2)
            popup.assert_called_with(app.route_menu, app.route_button)
        finally:
            _destroy_root(root)

    def test_ticket_mapping_fills_domestic_and_overseas_fields(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.ticket_mapping import (
            TicketMapping,
            TicketRoute,
            TicketSheetSnapshot,
        )

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            mapping = TicketMapping(
                source_issue="SERIA-10",
                target_issue="OSCOA-20",
                route=TicketRoute.DOMESTIC_TO_OVERSEAS,
                row=15,
                source_text="domestic",
                target_text="overseas",
                raw_text="mapping",
            )
            snapshot = TicketSheetSnapshot(
                url="https://example.invalid",
                sheet_id="sheet-1",
                sheet_name="0904（0910周更）",
                revision=12,
                fetched_at="2026-09-04T00:00:00+00:00",
                mappings=(mapping,),
            )

            with patch.object(app, "_start_jira_progress") as start_jira:
                app._apply_ticket_resolution(
                    snapshot,
                    (mapping,),
                    "SERIA-10",
                )
            start_jira.assert_called_once_with((mapping,))

            self.assertEqual(app.source_issue.get(), "SERIA-10")
            self.assertEqual(app.target_issue.get(), "OSCOA-20")
            self.assertIs(app.ticket_snapshot, snapshot)
            self.assertIn("第 15 行", app.status_text.get())
            self.assertEqual(
                app.trunk_table_button.cget("text"),
                "合海外 Trunk · 09/04",
            )
            self.assertEqual(
                str(app.update_button.cget("state")),
                "normal",
            )
            self.assertEqual(
                app.update_button.cget("style"),
                "Primary.TButton",
            )
            self.assertEqual(
                app.resolve_button.cget("style"),
                "Tool.TButton",
            )

            app._show_ticket_table(snapshot)
            root.update_idletasks()
            self.assertEqual(app.table_mode, "tickets")
            self.assertEqual(
                app.use_ticket_button.cget("style"),
                "Primary.TButton",
            )
            self.assertEqual(
                app.resolve_button.cget("style"),
                "Tool.TButton",
            )
            self.assertEqual(
                str(app.update_button.cget("state")),
                "disabled",
            )
            self.assertEqual(len(app.table.get_children()), 1)
            self.assertEqual(app.table.selection(), ("0",))
            self.assertEqual(
                app.table.item("0", "values")[2],
                "overseas",
            )
            app.table.selection_remove(app.table.selection())
            self.assertEqual(app._selected_ticket(), mapping)
            with patch.object(app, "_start_audit") as start_audit:
                app._use_ticket_mapping(
                    snapshot,
                    mapping,
                    start_audit=True,
                )
                root.after(180, root.quit)
                root.mainloop()
            start_audit.assert_called_once_with()

            app._show_progress_row(
                "扫描源提交",
                stage="source-log",
            )
            self.assertEqual(
                app.table.item("__progress__", "values")[:3],
                ("进行中", "source-log", "扫描源提交"),
            )
        finally:
            _destroy_root(root)

    def test_jira_progress_renders_without_local_workspace(self) -> None:
        from tkinter import Tk

        from migration_guard.app import TABLE_OSOB, MigrationGuardApp
        from migration_guard.jira_client import (
            JiraIssueSnapshot,
            build_ticket_progress,
        )
        from migration_guard.ticket_mapping import (
            TicketMapping,
            TicketRoute,
            TicketSheetSnapshot,
        )

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            mapping = TicketMapping(
                source_issue="SERIA-10",
                target_issue="OSCOA-20",
                route=TicketRoute.DOMESTIC_TO_OVERSEAS,
                row=15,
                source_text="国内任务",
                target_text="海外任务",
                raw_text="mapping",
            )
            app.ticket_snapshot = TicketSheetSnapshot(
                url="https://example.invalid",
                sheet_id="sheet-1",
                sheet_name="current",
                revision=12,
                fetched_at="2026-09-04T00:00:00+00:00",
                mappings=(mapping,),
            )
            progress = build_ticket_progress(
                (mapping,),
                {
                    "SERIA-10": JiraIssueSnapshot(
                        issue_key="SERIA-10",
                        status="主干测试",
                        versions=("trunk",),
                    ),
                    "OSCOA-20": JiraIssueSnapshot(
                        issue_key="OSCOA-20",
                        status="分支测试",
                        versions=("trunk", "OSOB2.0"),
                    ),
                },
            )

            app._render_jira_progress(progress)
            root.update_idletasks()

            self.assertEqual(app.table_mode, "jira")
            self.assertEqual(
                app.table.heading("state", "text"),
                "当前阶段",
            )
            self.assertEqual(
                app.table.item("0", "values")[0],
                "海外 OB",
            )
            self.assertEqual(
                app.table.item("0", "tags"),
                ("jira-osob",),
            )
            self.assertEqual(
                app.summary_text["complete"].get(),
                "1",
            )
            self.assertEqual(app._selected_tickets(), (mapping,))
            self.assertIn(
                "数据来源：Jira 状态与版本登记",
                app.detail.get("1.0", "end-1c"),
            )
            app.filter_state.set("待提交")
            app._refresh_table()
            self.assertEqual(app.table.get_children(), ())
            app.filter_state.set("已完成")
            app._refresh_table()
            self.assertEqual(app.table.get_children(), ("0",))

            app.active_table_kind = TABLE_OSOB
            trunk_only = build_ticket_progress(
                (mapping,),
                {
                    "SERIA-10": JiraIssueSnapshot(
                        issue_key="SERIA-10",
                        status="主干测试",
                        versions=("trunk",),
                    ),
                    "OSCOA-20": JiraIssueSnapshot(
                        issue_key="OSCOA-20",
                        status="分支测试",
                        versions=("trunk",),
                    ),
                },
            )
            app._render_jira_progress(trunk_only)
            self.assertEqual(app.summary_text["complete"].get(), "0")
            self.assertEqual(app.summary_text["pending_all"].get(), "1")
        finally:
            _destroy_root(root)

    def test_remote_assets_render_as_three_stage_tree(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.remote_asset_progress import (
            BranchEvidence,
            RemoteAssetProgress,
            RemoteAssetProgressResult,
        )
        from migration_guard.ticket_mapping import TicketMapping, TicketRoute

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            mapping = TicketMapping(
                source_issue="SERIA-10",
                target_issue="OSCOA-20",
                route=TicketRoute.DOMESTIC_TO_OVERSEAS,
                row=1,
                source_text="source",
                target_text="target",
                raw_text="",
            )
            app.current_ticket_mappings = (mapping,)
            result = RemoteAssetProgressResult(
                assets=(
                    RemoteAssetProgress(
                        module="res",
                        relative_path="Content/Done/A.uasset",
                        display_path="/res/Game/Done/A",
                        source_issues=("SERIA-10",),
                        target_issues=("OSCOA-20",),
                        domestic=BranchEvidence((10,), ("a",), "A"),
                        overseas_trunk=BranchEvidence(
                            (20,),
                            ("b",),
                            "A",
                        ),
                        osob=BranchEvidence((30,), ("c",), "A"),
                    ),
                    RemoteAssetProgress(
                        module="res",
                        relative_path="Content/Pending/B.uasset",
                        display_path="/res/Game/Pending/B",
                        source_issues=("SERIA-10",),
                        target_issues=("OSCOA-20",),
                        domestic=BranchEvidence((11,), ("a",), "M"),
                    ),
                )
            )

            app._render_remote_assets(result)
            root.update_idletasks()

            self.assertEqual(app.table_mode, "remote-assets")
            self.assertEqual(
                tuple(map(str, app.table.cget("show"))),
                ("tree", "headings"),
            )
            self.assertEqual(app.result_view.get(), "单号")
            self.assertEqual(app.table.heading("#0", "text"), "单号 / 资产")
            ticket_id = app.table.get_children()[0]
            self.assertEqual(
                app.table.item(ticket_id, "text"),
                "SER-10 → OSC-20 · target (2)",
            )
            self.assertEqual(
                app.table.item(ticket_id, "values")[:3],
                ("2/2", "1/2", "1/2"),
            )
            self.assertEqual(app.summary_text["all"].get(), "1")
            self.assertEqual(app.summary_text["pending_all"].get(), "1")
            self.assertRegex(
                app.last_refresh_text.get(),
                r"^上次刷新 \d{2}:\d{2}$",
            )
            self.assertTrue(
                app.detail.tag_ranges("issue-pending_commit")
            )

            app.result_view.set("资产")
            app._on_result_view_changed()
            self.assertEqual(app.table.heading("#0", "text"), "资产位置")
            root_id = app.table.get_children()[0]
            self.assertEqual(
                app.table.item(root_id, "values")[:3],
                ("2/2", "1/2", "1/2"),
            )
            game_id = app.table.get_children(root_id)[0]
            done_id = next(
                item_id
                for item_id in app.table.get_children(game_id)
                if app.table.item(item_id, "text").startswith("Done")
            )
            self.assertIn(
                "complete",
                app.table.item(done_id, "tags"),
            )
            app.table.selection_set(done_id)
            app._show_selected_detail()
            self.assertTrue(app.detail.tag_ranges("issue-complete"))
            self.assertEqual(
                app.detail.tag_cget("issue-complete", "foreground"),
                "#15803D",
            )
            self.assertEqual(app.summary_text["all"].get(), "2")
            self.assertEqual(app.summary_text["complete"].get(), "1")
            self.assertEqual(app.summary_text["pending_commit"].get(), "1")
            self.assertEqual(app.summary_text["pending_all"].get(), "1")
            self.assertEqual(app._selected_tickets(), (mapping,))
            self.assertIn(
                "展开目录可查看每个资产",
                app.detail.get("1.0", "end-1c"),
            )
            app.filter_state.set("已完成")
            app._refresh_table()
            filtered_root = app.table.get_children()[0]
            self.assertEqual(
                app.table.item(filtered_root, "values")[:3],
                ("1/1", "1/1", "1/1"),
            )
            app._set_summary_filter("待处理")
            pending_root = app.table.get_children()[0]
            self.assertEqual(
                app.table.item(pending_root, "values")[:3],
                ("1/1", "0/1", "0/1"),
            )
        finally:
            _destroy_root(root)

    def test_trunk_preview_treats_overseas_commit_as_complete(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.remote_asset_progress import (
            BranchEvidence,
            RemoteAssetProgress,
            RemoteAssetProgressResult,
        )
        from migration_guard.ticket_mapping import TicketMapping, TicketRoute

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            app.current_ticket_mappings = (
                TicketMapping(
                    "SERIA-10",
                    "OSCOA-20",
                    TicketRoute.DOMESTIC_TO_OVERSEAS,
                    1,
                    "source",
                    "target",
                    "raw",
                ),
            )
            result = RemoteAssetProgressResult(
                assets=(
                    RemoteAssetProgress(
                        module="res",
                        relative_path="Content/Done/A.uasset",
                        display_path="/res/Game/Done/A",
                        source_issues=("SERIA-10",),
                        target_issues=("OSCOA-20",),
                        domestic=BranchEvidence((10,), ("a",), "A"),
                        overseas_trunk=BranchEvidence(
                            (20,),
                            ("b",),
                            "A",
                        ),
                    ),
                )
            )

            app._render_remote_assets(result)

            self.assertEqual(app.summary_text["complete"].get(), "1")
            self.assertEqual(app.summary_text["pending_all"].get(), "0")
        finally:
            _destroy_root(root)

    def test_remote_preview_shows_missing_source_as_review_task(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.remote_asset_progress import (
            RemoteAssetProgressResult,
        )
        from migration_guard.ticket_mapping import TicketMapping, TicketRoute

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            app.current_ticket_mappings = (
                TicketMapping(
                    "SERIA-10",
                    "OSCOA-20",
                    TicketRoute.DOMESTIC_TO_OVERSEAS,
                    1,
                    "source",
                    "target",
                    "raw",
                ),
            )

            app._render_remote_assets(RemoteAssetProgressResult(assets=()))

            self.assertEqual(app.summary_text["needs_review"].get(), "1")
            self.assertEqual(app.summary_text["blocked"].get(), "0")
            self.assertEqual(
                app.table.item("remote-ticket-0", "values")[3],
                "需确认",
            )
            self.assertIn(
                "不表示迁移失败",
                app.detail.get("1.0", "end-1c"),
            )
        finally:
            _destroy_root(root)

    def test_remote_asset_folder_lists_exact_ticket_mappings(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.remote_asset_progress import (
            BranchEvidence,
            RemoteAssetProgress,
            RemoteAssetProgressResult,
        )
        from migration_guard.ticket_mapping import TicketMapping, TicketRoute

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            mappings = tuple(
                TicketMapping(
                    source_issue,
                    target_issue,
                    TicketRoute.DOMESTIC_TO_OVERSEAS,
                    row,
                    "source",
                    "target",
                    "raw",
                )
                for row, (source_issue, target_issue) in enumerate(
                    (
                        ("SERIA-10", "OSCOA-20"),
                        ("SERIA-11", "OSCOA-21"),
                    ),
                    start=1,
                )
            )
            app.current_ticket_mappings = mappings
            result = RemoteAssetProgressResult(
                assets=tuple(
                    RemoteAssetProgress(
                        module="doc",
                        relative_path=f"shared/{name}.csv",
                        display_path=f"/doc/shared/{name}.csv",
                        source_issues=(mapping.source_issue,),
                        target_issues=(mapping.target_issue,),
                        domestic=BranchEvidence((10,), ("a",), "M"),
                    )
                    for name, mapping in zip(("A", "B"), mappings)
                )
            )

            app._render_remote_assets(result)
            self.assertEqual(len(app.table.get_children()), 2)
            app.result_view.set("资产")
            app._on_result_view_changed()
            module_id = app.table.get_children()[0]
            folder_id = app.table.get_children(module_id)[0]
            app.table.selection_set(folder_id)
            app._show_selected_detail()
            detail = app.detail.get("1.0", "end-1c")

            self.assertIn("SER-10 → OSC-20 · target", detail)
            self.assertIn("SER-11 → OSC-21 · target", detail)
            self.assertNotIn("SER-10 → OSC-21", detail)
            self.assertNotIn("相对路径：", detail)
        finally:
            _destroy_root(root)

    def test_ticket_table_selects_all_domestic_rows_and_starts_batch(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.ticket_mapping import (
            TicketMapping,
            TicketRoute,
            TicketSheetSnapshot,
        )

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            mappings = tuple(
                TicketMapping(
                    source_issue=f"SERIA-{index}",
                    target_issue=f"OSCOA-{index}",
                    route=TicketRoute.DOMESTIC_TO_OVERSEAS,
                    row=index,
                    source_text=f"source-{index}",
                    target_text=f"target-{index}",
                    raw_text=f"row-{index}",
                )
                for index in (10, 11)
            )
            snapshot = TicketSheetSnapshot(
                url="https://example.invalid",
                sheet_id="sheet-1",
                sheet_name="current",
                revision=12,
                fetched_at="2026-09-04T00:00:00+00:00",
                mappings=mappings,
            )
            app._show_ticket_table(snapshot)

            self.assertEqual(len(app.table.selection()), 2)
            with patch.object(app, "_start_batch_audit") as start_batch:
                app._use_selected_ticket()
                root.after(180, root.quit)
                root.mainloop()

            self.assertEqual(app.current_ticket_mappings, mappings)
            start_batch.assert_called_once_with()
        finally:
            _destroy_root(root)

    def test_ticket_table_load_starts_remote_asset_preview(self) -> None:
        from tkinter import Tk

        from migration_guard.app import TABLE_TRUNK, MigrationGuardApp
        from migration_guard.ticket_mapping import (
            TicketMapping,
            TicketRoute,
            TicketSheetSnapshot,
        )

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            mapping = TicketMapping(
                "SERIA-10",
                "OSCOA-20",
                TicketRoute.DOMESTIC_TO_OVERSEAS,
                1,
                "source",
                "target",
                "raw",
            )
            snapshot = TicketSheetSnapshot(
                url="https://example.invalid",
                sheet_id="sheet-1",
                sheet_name="0904（0910周更）",
                revision=12,
                fetched_at="2026-09-04T00:00:00+00:00",
                mappings=(mapping,),
            )

            with patch.object(app, "_start_jira_progress") as preview:
                app._show_ticket_table(
                    snapshot,
                    TABLE_TRUNK,
                    start_preview=True,
                )

            preview.assert_called_once_with((mapping,))
            self.assertEqual(app.current_ticket_mappings, (mapping,))
            self.assertEqual(
                app.trunk_table_button.cget("text"),
                "合海外 Trunk · 09/04",
            )
        finally:
            _destroy_root(root)

    def test_route_selector_keeps_supported_workspaces_in_sync(self) -> None:
        from tkinter import Tk

        from migration_guard.app import (
            WORKSPACE_LABELS,
            MigrationGuardApp,
        )

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)

            self.assertEqual(
                app.target_workspace.get(),
                WORKSPACE_LABELS[WORKSPACE_OVERSEAS_TRUNK],
            )
            self.assertEqual(
                app.route_summary.get(),
                "国内 trunk → 海外 trunk",
            )
            app._set_workspace_route(WORKSPACE_OVERSEAS_TRUNK)

            self.assertEqual(
                app.source_workspace.get(),
                WORKSPACE_LABELS[WORKSPACE_OVERSEAS_TRUNK],
            )
            self.assertEqual(app.source_root.get(), r"D:\Oversea\OStrunk")
            self.assertEqual(app.target_root.get(), r"D:\Oversea\OSOB")
            self.assertEqual(
                app.route_summary.get(),
                "海外 trunk → 海外 OB",
            )
        finally:
            _destroy_root(root)

    def test_empty_scan_scope_infers_modules_and_externals(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.remote_asset_progress import (
            RemoteAssetProgress,
            RemoteAssetProgressResult,
        )

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(
                    enabled_modules=(),
                    include_externals=False,
                ),
            ):
                app = MigrationGuardApp(root)

            self.assertEqual(
                app._remote_module_names(),
                ("res", "doc", "bin"),
            )
            self.assertTrue(app._effective_include_externals())
            app.remote_asset_result = RemoteAssetProgressResult(
                assets=(
                    RemoteAssetProgress(
                        module="doc",
                        relative_path="csvdir/table.csv",
                        display_path="/doc/csvdir/table.csv",
                        source_issues=("SERIA-10",),
                        target_issues=("OSCOA-20",),
                    ),
                )
            )
            self.assertEqual(app._effective_module_names(), ("doc",))
        finally:
            _destroy_root(root)

    def test_batch_update_uses_selective_plan_then_reaudits(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.models import (
            BatchMigrationAuditResult,
            WorkspaceModule,
        )
        from migration_guard.selective_update import SelectiveUpdatePlan
        from migration_guard.ticket_mapping import (
            TicketMapping,
            TicketRoute,
        )

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            module = WorkspaceModule(
                "res",
                Path(r"C:\source\res"),
                Path(r"D:\target\res"),
            )
            mapping = TicketMapping(
                "SERIA-10",
                "OSCOA-20",
                TicketRoute.DOMESTIC_TO_OVERSEAS,
                1,
                "source",
                "target",
                "raw",
            )
            result = BatchMigrationAuditResult(
                started_at="start",
                finished_at="finish",
                cases=(),
            )
            audit_service = Mock()
            audit_service.svn = Mock()
            audit_service.audit_batch.side_effect = (result, result)
            plan = SelectiveUpdatePlan(
                targets=(Path(r"C:\source\res\Content\Game"),),
                source_path_count=1,
                stale_source_count=1,
                stale_target_count=0,
                fallback_count=0,
            )
            planner = Mock()
            planner.build.return_value = plan
            update_client = Mock()
            update_client.update_folders.return_value = {
                "ok": True,
                "executed_by": "svnmate",
                "status": "completed",
            }

            with (
                patch(
                    "migration_guard.app.MigrationAuditService",
                    return_value=audit_service,
                ),
                patch(
                    "migration_guard.app.SelectiveUpdatePlanner",
                    return_value=planner,
                ),
                patch(
                    "migration_guard.app.MigrationUpdateClient",
                    return_value=update_client,
                ),
            ):
                app._run_batch_background(
                    (module,),
                    (mapping,),
                    90,
                    False,
                    True,
                )

            self.assertEqual(audit_service.audit_batch.call_count, 2)
            planner.build.assert_called_once_with(result, (module,))
            update_client.update_folders.assert_called_once_with(
                plan.targets
            )
            events = []
            while not app.events.empty():
                events.append(app.events.get_nowait()[0])
            self.assertIn("update-plan", events)
            self.assertIn("update-result", events)
            self.assertIn("audit-result", events)
        finally:
            _destroy_root(root)

    def test_progress_bar_uses_completion_color(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)

            app._reset_workflow_progress("核验")
            app._update_workflow_progress("verify", "最终复核")
            self.assertEqual(app.workflow_progress.get(), 90)
            app._finish_workflow_progress(complete=True)

            self.assertEqual(app.workflow_progress.get(), 100)
            self.assertEqual(app.workflow_stage_text.get(), "全部完成")
            self.assertEqual(
                app.workflow_progress_bar.cget("style"),
                "WorkflowSuccess.Horizontal.TProgressbar",
            )
        finally:
            _destroy_root(root)

    def test_completed_batch_replaces_migrate_with_recheck(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.models import BatchMigrationAuditResult
        from migration_guard.ticket_mapping import TicketMapping, TicketRoute

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            mapping = TicketMapping(
                "SERIA-10",
                "OSCOA-20",
                TicketRoute.DOMESTIC_TO_OVERSEAS,
                1,
                "source",
                "target",
                "raw",
            )
            app.current_ticket_mappings = (mapping,)
            app.source_issue.set(mapping.source_issue)
            app.target_issue.set(mapping.target_issue)
            app.current_result = BatchMigrationAuditResult(
                started_at="start",
                finished_at="finish",
                cases=(),
            )

            with (
                patch.object(
                    BatchMigrationAuditResult,
                    "complete",
                    new_callable=lambda: property(lambda _self: True),
                ),
                patch.object(app, "_start_audit") as recheck,
            ):
                app._update_contextual_action_states()
                self.assertEqual(
                    app.migrate_button.cget("text"),
                    "复核",
                )
                app.migrate_button.invoke()

            recheck.assert_called_once_with()
        finally:
            _destroy_root(root)

    def test_submitted_items_count_as_complete_not_pending(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.models import VerificationState

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)

            app._set_summary_counts(
                2,
                {
                    VerificationState.COMPLETE: 1,
                    VerificationState.SUBMITTED: 1,
                },
            )

            self.assertEqual(app.summary_text["complete"].get(), "2")
            self.assertEqual(app.summary_text["pending_all"].get(), "0")
        finally:
            _destroy_root(root)

    def test_empty_case_is_visible_as_review_notice(self) -> None:
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.models import (
            BatchMigrationAuditResult,
            ExpectedChange,
            FileVerification,
            MigrationAuditResult,
            VerificationState,
        )
        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            expected = ExpectedChange(
                module="res",
                source_issue="SERIA-10",
                target_issue="OSCOA-20",
                source_path="/project/res/trunk/A.uasset",
                source_local_path=r"C:\trunk\res\A.uasset",
                target_path="/project/res/overseas/trunk/A.uasset",
                target_local_path=r"D:\Oversea\OStrunk\res\A.uasset",
                action="M",
                kind="file",
                source_revisions=(10,),
                source_authors=("tester",),
                source_messages=("source",),
            )
            complete_case = MigrationAuditResult(
                source_issue="SERIA-10",
                target_issue="OSCOA-20",
                started_at="start",
                finished_at="finish",
                files=(
                    FileVerification(
                        expected=expected,
                        state=VerificationState.COMPLETE,
                        local_status="normal",
                        repository_status="normal",
                        target_revisions=(20,),
                        reason="submitted",
                    ),
                ),
                modules=(),
                label="【OSCOA-20】海外资源描述",
            )
            missing_case = MigrationAuditResult(
                source_issue="SERIA-11",
                target_issue="OSCOA-21",
                started_at="start",
                finished_at="finish",
                files=(),
                modules=(),
                warnings=(
                    "查询范围内未找到 SERIA-11 的文件提交",
                ),
                label="【OSCOA-21】无资产任务描述",
            )
            result = BatchMigrationAuditResult(
                started_at="start",
                finished_at="finish",
                cases=(complete_case, missing_case),
            )

            app.current_result = result
            app._render_result(result)
            root.update_idletasks()

            self.assertFalse(result.complete)
            self.assertEqual(app.summary_text["all"].get(), "2")
            self.assertEqual(app.summary_text["complete"].get(), "1")
            self.assertEqual(app.summary_text["blocked"].get(), "0")
            self.assertEqual(app.summary_text["needs_review"].get(), "1")
            self.assertEqual(app.summary_text["pending_all"].get(), "1")
            self.assertEqual(
                tuple(map(str, app.table.cget("show"))),
                ("tree", "headings"),
            )
            self.assertEqual(
                app.table.item("audit-ticket-1", "values")[:2],
                ("需确认", "任务"),
            )
            self.assertIn(
                "SER-11 → OSC-21 · 无资产任务描述",
                app.table.item("audit-ticket-1", "text"),
            )
            self.assertTrue(
                any(
                    item_id.startswith("audit-ticket-0-dir-")
                    for item_id in app.table.get_children("audit-ticket-0")
                )
            )
            app.table.selection_set("audit-ticket-1")
            app._show_selected_detail()
            self.assertIn(
                "SERIA-11",
                app.detail.get("1.0", "end-1c"),
            )
            app.result_view.set("资产")
            app._on_result_view_changed()
            self.assertEqual(app.summary_text["all"].get(), "1")
            self.assertEqual(app.summary_text["needs_review"].get(), "0")

            app.current_result = result
            app.active_task = "audit"
            app.events.put(("done", "audit"))
            app._poll_events()

            self.assertIn("SERIA-11", app.status_text.get())
            self.assertIn("无源 SVN 变更", app.workflow_stage_text.get())
        finally:
            _destroy_root(root)

    def test_asset_view_deduplicates_shared_path_and_lists_tickets(
        self,
    ) -> None:
        from dataclasses import replace
        from tkinter import Tk

        from migration_guard.app import MigrationGuardApp
        from migration_guard.models import (
            BatchMigrationAuditResult,
            ExpectedChange,
            FileVerification,
            MigrationAuditResult,
            VerificationState,
        )
        from migration_guard.ticket_mapping import TicketMapping, TicketRoute

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            expected = ExpectedChange(
                module="doc",
                source_issue="SERIA-10",
                target_issue="OSCOA-20",
                source_path="/project/doc/trunk/data/shared.csv",
                source_local_path=r"C:\trunk\doc\data\shared.csv",
                target_path="/project/doc/overseas/trunk/data/shared.csv",
                target_local_path=r"D:\Oversea\OStrunk\doc\data\shared.csv",
                action="M",
                kind="file",
                source_revisions=(10,),
                source_authors=("tester",),
                source_messages=("source",),
            )
            cases = tuple(
                MigrationAuditResult(
                    source_issue=source_issue,
                    target_issue=target_issue,
                    started_at="start",
                    finished_at="finish",
                    files=(
                        FileVerification(
                            expected=replace(
                                expected,
                                source_issue=source_issue,
                                target_issue=target_issue,
                            ),
                            state=VerificationState.NOT_MIGRATED,
                            local_status="normal",
                            repository_status="normal",
                            reason="没有海外提交证据",
                        ),
                    ),
                    modules=(),
                )
                for source_issue, target_issue in (
                    ("SERIA-10", "OSCOA-20"),
                    ("SERIA-11", "OSCOA-21"),
                )
            )
            result = BatchMigrationAuditResult(
                started_at="start",
                finished_at="finish",
                cases=cases,
            )
            app.current_ticket_mappings = tuple(
                TicketMapping(
                    source_issue,
                    target_issue,
                    TicketRoute.DOMESTIC_TO_OVERSEAS,
                    row,
                    f"【{source_issue}】国内描述 {row}",
                    f"【{target_issue}】海外描述 {row}",
                    "raw",
                )
                for row, (source_issue, target_issue) in enumerate(
                    (
                        ("SERIA-10", "OSCOA-20"),
                        ("SERIA-11", "OSCOA-21"),
                    ),
                    start=1,
                )
            )
            app.current_result = result
            app._render_result(result)

            self.assertEqual(len(app.table.get_children()), 2)
            self.assertIn(
                "SER-10 → OSC-20 · 海外描述 1",
                app.table.item("audit-ticket-0", "text"),
            )
            app.result_view.set("资产")
            app._on_result_view_changed()

            self.assertEqual(app.summary_text["all"].get(), "1")
            leaf_id = next(iter(app.audit_tree_file_groups))
            self.assertEqual(
                len(app.audit_tree_file_groups[leaf_id]),
                2,
            )
            app.table.selection_set(leaf_id)
            app._show_selected_detail()
            detail = app.detail.get("1.0", "end-1c")
            self.assertIn("SER-10 → OSC-20 · 海外描述 1", detail)
            self.assertIn("SER-11 → OSC-21 · 海外描述 2", detail)
            self.assertNotIn("源路径：", detail)
            self.assertNotIn("目标路径：", detail)
        finally:
            _destroy_root(root)

    def test_osob_table_accepts_mixed_rows_and_builds_two_stage_tasks(
        self,
    ) -> None:
        from tkinter import Tk

        from migration_guard.app import TABLE_OSOB, MigrationGuardApp
        from migration_guard.ticket_mapping import (
            TicketMapping,
            TicketRoute,
            TicketSheetSnapshot,
        )

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            mappings = (
                TicketMapping(
                    "SERIA-10",
                    "OSCOA-20",
                    TicketRoute.DOMESTIC_TO_OVERSEAS,
                    1,
                    "source",
                    "target",
                    "raw",
                ),
                TicketMapping(
                    "OSCOA-21",
                    "OSCOA-21",
                    TicketRoute.OVERSEAS_TO_OSOB,
                    2,
                    "overseas",
                    "overseas",
                    "raw",
                ),
            )
            snapshot = TicketSheetSnapshot(
                url="https://example.invalid",
                sheet_id="latest",
                sheet_name="latest",
                revision=1,
                fetched_at="2026-09-04T00:00:00+00:00",
                mappings=mappings,
            )
            app._show_ticket_table(snapshot, TABLE_OSOB)

            self.assertEqual(len(app.table.selection()), 2)
            with patch.object(app, "_start_batch_audit") as start_batch:
                app._use_selected_ticket()
                root.after(180, root.quit)
                root.mainloop()

            self.assertEqual(app.current_ticket_mappings, mappings)
            self.assertEqual(
                tuple(
                    item.source_issue
                    for item in app._active_stage_mappings()
                ),
                ("SERIA-10",),
            )
            app._set_workspace_route(WORKSPACE_OVERSEAS_TRUNK)
            self.assertEqual(
                tuple(
                    item.source_issue
                    for item in app._active_stage_mappings()
                ),
                ("OSCOA-20", "OSCOA-21"),
            )
            start_batch.assert_called_once_with()
        finally:
            _destroy_root(root)

    def test_migration_picker_selects_all_assets_by_default(self) -> None:
        from tkinter import Tk, Toplevel

        from migration_guard.app import MigrationGuardApp
        from migration_guard.batch_workflow import (
            AssetMigrationItem,
            AssetMigrationPlan,
        )

        root = Tk()
        root.withdraw()
        try:
            with patch(
                "migration_guard.app.load_config",
                return_value=MigrationGuardConfig(),
            ):
                app = MigrationGuardApp(root)
            plan = AssetMigrationPlan(
                assets=(
                    AssetMigrationItem(
                        "/Game/A",
                        r"C:\source\A.uasset",
                        r"D:\target\A.uasset",
                        ("SERIA-10",),
                        ("OSCOA-20",),
                    ),
                    AssetMigrationItem(
                        "/Game/B",
                        r"C:\source\B.uasset",
                        r"D:\target\B.uasset",
                        ("SERIA-11",),
                        ("OSCOA-21",),
                    ),
                ),
                manual_files=(),
                already_handled_count=0,
            )

            def invoke_confirm() -> None:
                for child in root.winfo_children():
                    if not isinstance(child, Toplevel):
                        continue
                    for widget in _walk_widgets(child):
                        try:
                            text = str(widget.cget("text"))
                        except Exception:
                            continue
                        if text.startswith("迁移选中"):
                            widget.invoke()
                            return
                root.after(20, invoke_confirm)

            root.after(50, invoke_confirm)
            selected = app._choose_migration_assets(plan)

            self.assertEqual(selected, ("/Game/A", "/Game/B"))
        finally:
            _destroy_root(root)


if __name__ == "__main__":
    unittest.main()
