import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
            }
        )

        self.assertEqual(config.enabled_modules, ("res", "doc", "bin"))
        self.assertEqual(config.lookback_days, 90)

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
                root.update_idletasks()

            self.assertEqual(root.title(), "迁移核验助手")
            self.assertEqual(
                tuple(app.table["columns"]),
                ("state", "module", "path", "source", "local", "target"),
            )
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
                sheet_name="current",
                revision=12,
                fetched_at="2026-09-04T00:00:00+00:00",
                mappings=(mapping,),
            )

            app._apply_ticket_resolution(
                snapshot,
                (mapping,),
                "SERIA-10",
            )

            self.assertEqual(app.source_issue.get(), "SERIA-10")
            self.assertEqual(app.target_issue.get(), "OSCOA-20")
            self.assertIn("第 15 行", app.status_text.get())

            app._show_ticket_table(snapshot)
            root.update_idletasks()
            self.assertEqual(app.table_mode, "tickets")
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

    def test_workspace_selectors_keep_supported_routes_in_sync(self) -> None:
        from tkinter import Tk

        from migration_guard.app import (
            WORKSPACE_LABELS,
            WORKSPACE_OSOB,
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
            app.target_workspace.set(WORKSPACE_LABELS[WORKSPACE_OSOB])
            app._on_target_workspace_selected()

            self.assertEqual(
                app.source_workspace.get(),
                WORKSPACE_LABELS[WORKSPACE_OVERSEAS_TRUNK],
            )
            self.assertEqual(app.source_root.get(), r"D:\Oversea\OStrunk")
            self.assertEqual(app.target_root.get(), r"D:\Oversea\OSOB")
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
