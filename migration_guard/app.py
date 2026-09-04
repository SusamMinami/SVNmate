from __future__ import annotations

import ctypes
import json
import os
import queue
import subprocess
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from tkinter import (
    BOTH,
    END,
    HORIZONTAL,
    LEFT,
    RIGHT,
    VERTICAL,
    X,
    BooleanVar,
    IntVar,
    StringVar,
    Text,
    Tk,
    Toplevel,
    filedialog,
    messagebox,
)
from tkinter import ttk

from .asset_tree import (
    CHECKED,
    PARTIAL,
    AssetTreeSelection,
)
from .audit import MigrationAuditService, default_workspace_modules
from .batch_workflow import AssetMigrationPlan, BatchMigrationExecutor
from .config import (
    WORKSPACE_DOMESTIC,
    WORKSPACE_OVERSEAS_TRUNK,
    MigrationGuardConfig,
    load_config,
    save_config,
)
from .models import (
    BatchMigrationAuditResult,
    FileVerification,
    MigrationCase,
    MigrationAuditResult,
    VerificationState,
    WorkspaceModule,
)
from .svn_client import SvnClient
from .svn_update_client import MigrationUpdateClient
from .ticket_mapping import (
    LarkTicketSheetClient,
    TicketMapping,
    TicketRoute,
    TicketSheetSnapshot,
    TicketTextResolution,
    as_overseas_to_osob,
    resolve_ticket_text,
    workbook_url,
)


if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).resolve().parent
else:
    APP_DIR = Path(__file__).resolve().parents[1]
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))
APP_ICON_PATH = RESOURCE_DIR / "svnmate.ico"
APP_TITLE = "迁移核验助手"
UI_POLL_MS = 100
TABLE_TRUNK = "trunk"
TABLE_OSOB = "osob"
WORKSPACE_OSOB = "osob"
WORKSPACE_LABELS = {
    WORKSPACE_DOMESTIC: "国内 trunk",
    WORKSPACE_OVERSEAS_TRUNK: "海外 trunk",
    WORKSPACE_OSOB: "海外 OB",
}


def _enable_windows_dpi_awareness() -> None:
    if os.name != "nt":
        return
    try:
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(
            ctypes.c_void_p(-4)
        ):
            return
    except (AttributeError, OSError):
        pass
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass


class MigrationGuardApp:
    FILTERS = (
        "全部",
        "未迁移",
        "待提交",
        "已完成",
        "已提交",
        "需更新",
        "需确认",
        "阻断",
    )

    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title(APP_TITLE)
        self.root.minsize(920, 640)
        initial_width = min(1180, max(920, root.winfo_screenwidth() - 40))
        initial_height = min(
            760,
            max(640, root.winfo_screenheight() - 80),
        )
        self.root.geometry(f"{initial_width}x{initial_height}")
        if APP_ICON_PATH.is_file():
            try:
                self.root.iconbitmap(default=str(APP_ICON_PATH))
            except Exception:
                pass

        config = load_config()
        self.domestic_root = StringVar(value=config.domestic_root)
        self.overseas_trunk_root = StringVar(
            value=config.overseas_trunk_root
        )
        self.overseas_ob_root = StringVar(value=config.overseas_ob_root)
        self.source_workspace = StringVar()
        self.target_workspace = StringVar()
        self.source_root = StringVar()
        self.target_root = StringVar()
        self.source_issue = StringVar()
        self.target_issue = StringVar()
        self.lookback_days = IntVar(value=config.lookback_days)
        self.include_externals = BooleanVar(value=config.include_externals)
        self.trunk_sheet_url = StringVar(value=config.trunk_sheet_url)
        self.osob_sheet_url = StringVar(value=config.osob_sheet_url)
        self.module_enabled = {
            name: BooleanVar(value=name in config.enabled_modules)
            for name in ("res", "doc", "bin")
        }
        self.filter_state = StringVar(value="全部")
        self.status_text = StringVar(value="就绪")
        self.summary_text = {
            "all": StringVar(value="0"),
            VerificationState.NOT_MIGRATED.value: StringVar(value="0"),
            VerificationState.PENDING_COMMIT.value: StringVar(value="0"),
            VerificationState.COMPLETE.value: StringVar(value="0"),
            VerificationState.SUBMITTED.value: StringVar(value="0"),
            VerificationState.NEEDS_UPDATE.value: StringVar(value="0"),
            VerificationState.NEEDS_REVIEW.value: StringVar(value="0"),
            VerificationState.BLOCKED.value: StringVar(value="0"),
        }
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.busy = False
        self.task_failed = False
        self.active_task = ""
        self.current_result: (
            MigrationAuditResult | BatchMigrationAuditResult | None
        ) = None
        self.current_ticket_mapping: TicketMapping | None = None
        self.current_ticket_mappings: tuple[TicketMapping, ...] = ()
        self.visible_files: list[FileVerification] = []
        self.visible_ticket_mappings: list[TicketMapping] = []
        self.ticket_snapshot: TicketSheetSnapshot | None = None
        self.ticket_snapshots: dict[str, TicketSheetSnapshot] = {}
        self.active_table_kind = TABLE_TRUNK
        self.table_mode = "audit"
        self.settings_window: Toplevel | None = None
        self._workspace_syncing = False
        self._ticket_parse_after_id: str | None = None
        self._set_workspace_route(config.source_workspace, save=False)

        self._build_styles()
        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(UI_POLL_MS, self._poll_events)

    def _build_styles(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure("App.TFrame", background="#F6F7F9")
        style.configure("Panel.TFrame", background="#FFFFFF")
        style.configure(
            "Title.TLabel",
            background="#F6F7F9",
            foreground="#1F2937",
            font=("Segoe UI Semibold", 18),
        )
        style.configure(
            "DialogTitle.TLabel",
            background="#F6F7F9",
            foreground="#1F2937",
            font=("Segoe UI Semibold", 12),
        )
        style.configure(
            "Muted.TLabel",
            background="#F6F7F9",
            foreground="#667085",
            font=("Segoe UI", 10),
        )
        style.configure(
            "Panel.TLabel",
            background="#FFFFFF",
            foreground="#1F2937",
            font=("Segoe UI", 10),
        )
        style.configure(
            "Summary.TLabel",
            background="#FFFFFF",
            foreground="#344054",
            font=("Segoe UI Semibold", 10),
            padding=(10, 6),
        )
        style.configure(
            "Summary.TRadiobutton",
            background="#FFFFFF",
            foreground="#344054",
            font=("Segoe UI Semibold", 10),
            padding=(8, 6),
        )
        style.configure(
            "Primary.TButton",
            background="#2563EB",
            foreground="#FFFFFF",
            font=("Segoe UI Semibold", 10),
            padding=(12, 7),
            borderwidth=0,
        )
        style.map(
            "Primary.TButton",
            background=[("active", "#1D4ED8"), ("disabled", "#9CA3AF")],
        )
        style.configure(
            "Tool.TButton",
            background="#FFFFFF",
            foreground="#344054",
            font=("Segoe UI", 10),
            padding=(9, 6),
        )
        style.configure(
            "Treeview",
            background="#FFFFFF",
            fieldbackground="#FFFFFF",
            foreground="#1F2937",
            rowheight=28,
            font=("Segoe UI", 10),
        )
        style.configure(
            "Treeview.Heading",
            background="#EEF1F5",
            foreground="#344054",
            font=("Segoe UI Semibold", 10),
            padding=(6, 6),
        )

    def _build_ui(self) -> None:
        container = ttk.Frame(
            self.root,
            style="App.TFrame",
            padding=(14, 12, 14, 10),
        )
        container.pack(fill=BOTH, expand=True)

        header = ttk.Frame(container, style="App.TFrame")
        header.pack(fill=X)
        ttk.Label(
            header,
            text=APP_TITLE,
            style="Title.TLabel",
        ).pack(side=LEFT)
        self.sheet_config_button = ttk.Button(
            header,
            text="⚙",
            width=4,
            style="Tool.TButton",
            command=self._configure_ticket_sheet,
        )
        self.sheet_config_button.pack(side=RIGHT)
        self._attach_tooltip(
            self.sheet_config_button,
            "工作区与固定表设置",
        )
        self.osob_table_button = ttk.Button(
            header,
            text="海外 OB 表",
            style="Tool.TButton",
            command=lambda: self._start_ticket_table(TABLE_OSOB),
        )
        self.osob_table_button.pack(side=RIGHT, padx=(0, 4))
        self.trunk_table_button = ttk.Button(
            header,
            text="Trunk 表",
            style="Tool.TButton",
            command=lambda: self._start_ticket_table(TABLE_TRUNK),
        )
        self.trunk_table_button.pack(side=RIGHT, padx=(0, 6))

        paths = ttk.Frame(container, style="Panel.TFrame", padding=(10, 8))
        paths.pack(fill=X, pady=(10, 6))
        ttk.Label(
            paths,
            text="源",
            style="Panel.TLabel",
        ).grid(row=0, column=0, sticky="w")
        self.source_workspace_combo = ttk.Combobox(
            paths,
            textvariable=self.source_workspace,
            values=(
                WORKSPACE_LABELS[WORKSPACE_DOMESTIC],
                WORKSPACE_LABELS[WORKSPACE_OVERSEAS_TRUNK],
            ),
            state="readonly",
            width=13,
        )
        self.source_workspace_combo.grid(
            row=0,
            column=1,
            sticky="ew",
            padx=(5, 5),
        )
        self.source_workspace_combo.bind(
            "<<ComboboxSelected>>",
            self._on_source_workspace_selected,
        )
        ttk.Entry(
            paths,
            textvariable=self.source_root,
            state="readonly",
        ).grid(row=0, column=2, sticky="ew", padx=(0, 10))
        ttk.Label(
            paths,
            text="→",
            style="Panel.TLabel",
        ).grid(row=0, column=3)
        ttk.Label(
            paths,
            text="目标",
            style="Panel.TLabel",
        ).grid(row=0, column=4, sticky="w", padx=(10, 0))
        self.target_workspace_combo = ttk.Combobox(
            paths,
            textvariable=self.target_workspace,
            values=(
                WORKSPACE_LABELS[WORKSPACE_OVERSEAS_TRUNK],
                WORKSPACE_LABELS[WORKSPACE_OSOB],
            ),
            state="readonly",
            width=13,
        )
        self.target_workspace_combo.grid(
            row=0,
            column=5,
            sticky="ew",
            padx=(5, 5),
        )
        self.target_workspace_combo.bind(
            "<<ComboboxSelected>>",
            self._on_target_workspace_selected,
        )
        ttk.Entry(
            paths,
            textvariable=self.target_root,
            state="readonly",
        ).grid(row=0, column=6, sticky="ew")
        paths.columnconfigure(2, weight=1)
        paths.columnconfigure(6, weight=1)

        task_row = ttk.Frame(container, style="Panel.TFrame", padding=(10, 8))
        task_row.pack(fill=X, pady=(0, 6))
        command_row = ttk.Frame(task_row, style="Panel.TFrame")
        command_row.pack(fill=X)
        option_row = ttk.Frame(task_row, style="Panel.TFrame")
        option_row.pack(fill=X, pady=(6, 0))
        actions = ttk.Frame(command_row, style="Panel.TFrame")
        actions.pack(side=RIGHT)
        self.audit_button = ttk.Button(
            actions,
            text="复核",
            style="Tool.TButton",
            command=self._start_audit,
        )
        self.audit_button.pack(side=RIGHT)
        self.migrate_button = ttk.Button(
            actions,
            text="迁移",
            style="Primary.TButton",
            command=self._start_batch_migration,
            state="disabled",
        )
        self.migrate_button.pack(side=RIGHT, padx=(0, 6))
        self.update_button = ttk.Button(
            actions,
            text="更新",
            style="Tool.TButton",
            command=self._start_update_and_audit,
        )
        self.update_button.pack(side=RIGHT, padx=(0, 6))
        ttk.Label(
            command_row,
            text="粘贴单号",
            style="Panel.TLabel",
        ).pack(side=LEFT, anchor="n", pady=(5, 0))
        self.ticket_input = Text(
            command_row,
            height=2,
            wrap="word",
            relief="solid",
            borderwidth=1,
            background="#FFFFFF",
            foreground="#1F2937",
            font=("Segoe UI", 10),
            padx=6,
            pady=4,
        )
        self.ticket_input.pack(
            side=LEFT,
            fill=X,
            expand=True,
            padx=(7, 8),
        )
        self.ticket_input.bind("<<Paste>>", self._schedule_ticket_resolution)
        self.ticket_input.bind(
            "<Control-Return>",
            self._start_ticket_resolution,
        )
        self.resolve_button = ttk.Button(
            command_row,
            text="解析",
            style="Tool.TButton",
            command=self._start_ticket_resolution,
        )
        self.resolve_button.pack(side=LEFT, anchor="n")
        ttk.Label(
            option_row,
            text="源单号",
            style="Panel.TLabel",
        ).pack(side=LEFT)
        ttk.Entry(
            option_row,
            textvariable=self.source_issue,
            width=24,
            state="readonly",
        ).pack(side=LEFT, padx=(5, 10), fill=X, expand=True)
        ttk.Label(
            option_row,
            text="海外目标",
            style="Panel.TLabel",
        ).pack(side=LEFT)
        ttk.Entry(
            option_row,
            textvariable=self.target_issue,
            width=24,
            state="readonly",
        ).pack(side=LEFT, padx=(5, 12), fill=X, expand=True)
        for name in ("res", "doc", "bin"):
            ttk.Checkbutton(
                option_row,
                text=name,
                variable=self.module_enabled[name],
            ).pack(side=LEFT, padx=(0, 6))
        ttk.Checkbutton(
            option_row,
            text="externals",
            variable=self.include_externals,
        ).pack(side=LEFT, padx=(2, 8))
        ttk.Label(
            option_row,
            text="天数",
            style="Panel.TLabel",
        ).pack(side=LEFT)
        ttk.Spinbox(
            option_row,
            from_=1,
            to=3650,
            width=5,
            textvariable=self.lookback_days,
        ).pack(side=LEFT, padx=(5, 0))

        summary = ttk.Frame(container, style="Panel.TFrame", padding=(6, 3))
        summary.pack(fill=X, pady=(0, 6))
        summary_items = (
            ("全部", "all"),
            ("未迁移", VerificationState.NOT_MIGRATED.value),
            ("待提交", VerificationState.PENDING_COMMIT.value),
            ("已完成", VerificationState.COMPLETE.value),
            ("已提交", VerificationState.SUBMITTED.value),
            ("需更新", VerificationState.NEEDS_UPDATE.value),
            ("需确认", VerificationState.NEEDS_REVIEW.value),
            ("阻断", VerificationState.BLOCKED.value),
        )
        for label, key in summary_items:
            button = ttk.Radiobutton(
                summary,
                text=label,
                value=label,
                variable=self.filter_state,
                command=self._refresh_table,
                style="Summary.TRadiobutton",
            )
            button.pack(side=LEFT, padx=(0, 2))
            ttk.Label(
                summary,
                textvariable=self.summary_text[key],
                style="Summary.TLabel",
                width=3,
            ).pack(side=LEFT, padx=(0, 5))

        body = ttk.Panedwindow(container, orient=HORIZONTAL)
        body.pack(fill=BOTH, expand=True)
        self.body = body
        table_panel = ttk.Frame(body, style="Panel.TFrame", padding=1)
        detail_panel = ttk.Frame(body, style="Panel.TFrame", padding=(10, 8))
        body.add(table_panel, weight=7)
        body.add(detail_panel, weight=3)
        self.root.after(300, self._set_initial_sash)

        columns = (
            "state",
            "module",
            "path",
            "source",
            "local",
            "target",
        )
        self.table = ttk.Treeview(
            table_panel,
            columns=columns,
            show="headings",
            selectmode="extended",
        )
        headings = {
            "state": "状态",
            "module": "模块",
            "path": "相对路径",
            "source": "源版本",
            "local": "目标本地",
            "target": "海外提交",
        }
        widths = {
            "state": 76,
            "module": 58,
            "path": 330,
            "source": 96,
            "local": 86,
            "target": 100,
        }
        for name in columns:
            self.table.heading(name, text=headings[name])
            self.table.column(
                name,
                width=widths[name],
                minwidth=widths[name],
                stretch=name == "path",
                anchor="w" if name == "path" else "center",
            )
        self.table.tag_configure("complete", foreground="#15803D")
        self.table.tag_configure("submitted", foreground="#047857")
        self.table.tag_configure("pending_commit", foreground="#B45309")
        self.table.tag_configure("not_migrated", foreground="#B42318")
        self.table.tag_configure("needs_update", foreground="#2563EB")
        self.table.tag_configure("needs_review", foreground="#6D5BD0")
        self.table.tag_configure("blocked", foreground="#B42318")
        self.table.tag_configure(
            TicketRoute.DOMESTIC_TO_OVERSEAS.value,
            foreground="#2563EB",
        )
        self.table.tag_configure(
            TicketRoute.OVERSEAS_TO_OSOB.value,
            foreground="#6D5BD0",
        )
        self.table.tag_configure(
            TicketRoute.OSOB_ONLY.value,
            foreground="#B45309",
        )
        self.table.tag_configure(
            TicketRoute.SKIP.value,
            foreground="#B42318",
        )
        self.table.bind("<<TreeviewSelect>>", self._show_selected_detail)
        self.table.bind("<Double-1>", self._on_table_double_click)

        y_scroll = ttk.Scrollbar(
            table_panel,
            orient=VERTICAL,
            command=self.table.yview,
        )
        x_scroll = ttk.Scrollbar(
            table_panel,
            orient=HORIZONTAL,
            command=self.table.xview,
        )
        self.table.configure(
            yscrollcommand=y_scroll.set,
            xscrollcommand=x_scroll.set,
        )
        self.table.grid(row=0, column=0, sticky="nsew")
        y_scroll.grid(row=0, column=1, sticky="ns")
        x_scroll.grid(row=1, column=0, sticky="ew")
        table_panel.rowconfigure(0, weight=1)
        table_panel.columnconfigure(0, weight=1)

        detail_header = ttk.Frame(detail_panel, style="Panel.TFrame")
        detail_header.pack(fill=X)
        ttk.Label(
            detail_header,
            text="核验详情",
            style="Panel.TLabel",
        ).pack(side=LEFT)
        self.open_path_button = ttk.Button(
            detail_header,
            text="打开位置",
            style="Tool.TButton",
            command=self._open_selected_path,
        )
        self.open_path_button.pack(side=RIGHT)
        self.use_ticket_button = ttk.Button(
            detail_header,
            text="使用选中",
            style="Primary.TButton",
            command=self._use_selected_ticket,
            state="disabled",
        )
        self.use_ticket_button.pack(side=RIGHT, padx=(0, 6))
        self.detail = Text(
            detail_panel,
            wrap="word",
            relief="flat",
            borderwidth=0,
            background="#FFFFFF",
            foreground="#344054",
            font=("Consolas", 10),
            padx=2,
            pady=8,
        )
        self.detail.pack(fill=BOTH, expand=True)
        self.detail.configure(state="disabled")

        footer = ttk.Frame(container, style="App.TFrame")
        footer.pack(fill=X, pady=(6, 0))
        self.export_button = ttk.Button(
            footer,
            text="导出结果",
            style="Tool.TButton",
            command=self._export_result,
            state="disabled",
        )
        self.export_button.pack(side=RIGHT)
        ttk.Label(
            footer,
            textvariable=self.status_text,
            style="Muted.TLabel",
        ).pack(side=LEFT)

    def _set_initial_sash(self) -> None:
        width = self.body.winfo_width()
        if width > 1:
            self.body.sashpos(0, int(width * 0.7))

    def _attach_tooltip(
        self,
        widget: ttk.Widget,
        text: str,
    ) -> None:
        tooltip: Toplevel | None = None

        def show(_event: object = None) -> None:
            nonlocal tooltip
            if tooltip is not None:
                return
            tooltip = Toplevel(self.root)
            tooltip.overrideredirect(True)
            tooltip.attributes("-topmost", True)
            ttk.Label(
                tooltip,
                text=text,
                style="Panel.TLabel",
                padding=(7, 4),
            ).pack()
            tooltip.geometry(
                f"+{widget.winfo_rootx()}+"
                f"{widget.winfo_rooty() + widget.winfo_height() + 4}"
            )

        def hide(_event: object = None) -> None:
            nonlocal tooltip
            if tooltip is not None:
                tooltip.destroy()
                tooltip = None

        widget.bind("<Enter>", show, add="+")
        widget.bind("<Leave>", hide, add="+")

    def _workspace_path(self, role: str) -> str:
        return {
            WORKSPACE_DOMESTIC: self.domestic_root.get(),
            WORKSPACE_OVERSEAS_TRUNK: self.overseas_trunk_root.get(),
            WORKSPACE_OSOB: self.overseas_ob_root.get(),
        }[role]

    @staticmethod
    def _workspace_role(label: str) -> str:
        for role, role_label in WORKSPACE_LABELS.items():
            if label == role_label:
                return role
        raise ValueError(f"未知工作区：{label}")

    def _set_workspace_route(
        self,
        source_role: str,
        *,
        save: bool = True,
    ) -> None:
        if source_role not in {
            WORKSPACE_DOMESTIC,
            WORKSPACE_OVERSEAS_TRUNK,
        }:
            source_role = WORKSPACE_DOMESTIC
        target_role = (
            WORKSPACE_OVERSEAS_TRUNK
            if source_role == WORKSPACE_DOMESTIC
            else WORKSPACE_OSOB
        )
        self._workspace_syncing = True
        try:
            self.source_workspace.set(WORKSPACE_LABELS[source_role])
            self.target_workspace.set(WORKSPACE_LABELS[target_role])
            self.source_root.set(self._workspace_path(source_role))
            self.target_root.set(self._workspace_path(target_role))
        finally:
            self._workspace_syncing = False
        if save:
            self._save_config()

    def _on_source_workspace_selected(
        self,
        _event: object = None,
    ) -> None:
        if self._workspace_syncing:
            return
        self._set_workspace_route(
            self._workspace_role(self.source_workspace.get())
        )

    def _on_target_workspace_selected(
        self,
        _event: object = None,
    ) -> None:
        if self._workspace_syncing:
            return
        target_role = self._workspace_role(self.target_workspace.get())
        source_role = (
            WORKSPACE_DOMESTIC
            if target_role == WORKSPACE_OVERSEAS_TRUNK
            else WORKSPACE_OVERSEAS_TRUNK
        )
        self._set_workspace_route(source_role)

    def _selected_modules_for_roots(
        self,
        source_root: str,
        target_root: str,
    ) -> tuple[WorkspaceModule, ...]:
        enabled = [
            name
            for name, variable in self.module_enabled.items()
            if variable.get()
        ]
        if not enabled:
            raise ValueError("请至少选择一个模块")
        modules = default_workspace_modules(
            Path(source_root),
            Path(target_root),
            enabled,
        )
        missing = [
            str(path)
            for module in modules
            for path in (module.source_path, module.target_path)
            if not path.is_dir()
        ]
        if missing:
            raise ValueError("工作目录不存在：\n" + "\n".join(missing))
        return modules

    def _selected_modules(self) -> tuple[WorkspaceModule, ...]:
        return self._selected_modules_for_roots(
            self.source_root.get().strip(),
            self.target_root.get().strip(),
        )

    def _current_config(self) -> MigrationGuardConfig:
        source_role = self._workspace_role(self.source_workspace.get())
        return MigrationGuardConfig(
            domestic_root=self.domestic_root.get().strip(),
            overseas_trunk_root=self.overseas_trunk_root.get().strip(),
            overseas_ob_root=self.overseas_ob_root.get().strip(),
            source_workspace=source_role,
            enabled_modules=tuple(
                name
                for name, variable in self.module_enabled.items()
                if variable.get()
            ),
            lookback_days=self.lookback_days.get(),
            include_externals=self.include_externals.get(),
            trunk_sheet_url=self.trunk_sheet_url.get().strip(),
            osob_sheet_url=self.osob_sheet_url.get().strip(),
        )

    def _save_config(self) -> None:
        try:
            save_config(self._current_config())
        except (OSError, ValueError):
            pass

    def _table_url(self, table_kind: str) -> str:
        variable = (
            self.osob_sheet_url
            if table_kind == TABLE_OSOB
            else self.trunk_sheet_url
        )
        return workbook_url(variable.get().strip())

    def _start_ticket_table(self, table_kind: str = TABLE_TRUNK) -> None:
        if self.busy:
            messagebox.showinfo("任务执行中", "当前任务尚未完成。")
            return
        sheet_url = self._table_url(table_kind)
        if not sheet_url:
            messagebox.showwarning(
                "缺少固定表",
                "请先在设置中配置对应的飞书工作簿链接。",
            )
            return
        self.active_table_kind = table_kind
        self._set_workspace_route(WORKSPACE_DOMESTIC)
        self.busy = True
        self.task_failed = False
        self.active_task = "table"
        self._set_action_buttons("disabled")
        table_label = "海外 OB 表" if table_kind == TABLE_OSOB else "Trunk 表"
        self.status_text.set(f"读取{table_label}最新页签...")
        threading.Thread(
            target=self._ticket_table_worker,
            args=(table_kind, sheet_url),
            name="migration-ticket-table",
            daemon=True,
        ).start()

    def _ticket_table_worker(
        self,
        table_kind: str,
        sheet_url: str,
    ) -> None:
        try:
            snapshot = LarkTicketSheetClient(sheet_url).fetch(
                force_refresh=True
            )
            self.events.put(
                ("ticket-table", (table_kind, snapshot))
            )
        except Exception as exc:
            self.events.put(("error", str(exc)))
        finally:
            self.events.put(("done", "table"))

    def _show_ticket_table(
        self,
        snapshot: TicketSheetSnapshot,
        table_kind: str | None = None,
    ) -> None:
        if table_kind is not None:
            self.active_table_kind = table_kind
        self.ticket_snapshots[self.active_table_kind] = snapshot
        self._render_ticket_snapshot(snapshot)

    def _render_ticket_snapshot(
        self,
        snapshot: TicketSheetSnapshot,
    ) -> None:
        self.table_mode = "tickets"
        self.ticket_snapshot = snapshot
        self.current_result = None
        self.migrate_button.configure(state="disabled")
        self.visible_files = []
        self.visible_ticket_mappings = [
            mapping
            for mapping in snapshot.mappings
            if self._mapping_allowed_for_active_table(mapping)
        ]
        self.table.delete(*self.table.get_children())
        headings = {
            "state": "路线",
            "module": "行",
            "path": "内容",
            "source": "源单号",
            "local": "目标单号",
            "target": "来源",
        }
        widths = {
            "state": 145,
            "module": 46,
            "path": 310,
            "source": 105,
            "local": 105,
            "target": 58,
        }
        for name in self.table["columns"]:
            self.table.heading(name, text=headings[name])
            self.table.column(
                name,
                width=widths[name],
                minwidth=widths[name],
                stretch=name == "path",
                anchor="w" if name == "path" else "center",
            )
        source_label = "缓存" if snapshot.from_cache else "飞书"
        for index, mapping in enumerate(self.visible_ticket_mappings):
            self.table.insert(
                "",
                END,
                iid=str(index),
                values=(
                    mapping.route.label,
                    mapping.row,
                    mapping.target_text or mapping.source_text,
                    mapping.source_issue,
                    mapping.target_issue or "-",
                    source_label,
                ),
                tags=(mapping.route.value,),
            )
        children = self.table.get_children()
        if children:
            default_selection = tuple(
                str(index)
                for index, mapping in enumerate(
                    self.visible_ticket_mappings
                )
                if mapping.route in {
                    TicketRoute.DOMESTIC_TO_OVERSEAS,
                    TicketRoute.OVERSEAS_TO_OSOB,
                }
            )
            self.table.selection_set(default_selection)
            self.table.focus(default_selection[0])
            self.table.see(default_selection[0])
        self.use_ticket_button.configure(
            text=f"核验选中（{len(self.table.selection())}）",
            state="normal",
        )
        self.open_path_button.configure(state="disabled")
        self.export_button.configure(state="disabled")
        self.summary_text["all"].set(
            str(len(self.visible_ticket_mappings))
        )
        for state in VerificationState:
            self.summary_text[state.value].set("0")
        self.status_text.set(
            f"{snapshot.sheet_name}："
            f"{len(self.visible_ticket_mappings)} 条，选择后开始核验"
        )
        self._show_selected_detail()

    def _configure_ticket_sheet(self) -> None:
        if self.settings_window is not None:
            try:
                self.settings_window.lift()
                self.settings_window.focus_force()
                return
            except Exception:
                self.settings_window = None

        window = Toplevel(self.root)
        self.settings_window = window
        window.title("迁移设置")
        window.geometry("760x340")
        window.minsize(680, 320)
        window.transient(self.root)
        if APP_ICON_PATH.is_file():
            try:
                window.iconbitmap(default=str(APP_ICON_PATH))
            except Exception:
                pass

        values = {
            "domestic": StringVar(value=self.domestic_root.get()),
            "overseas": StringVar(value=self.overseas_trunk_root.get()),
            "osob": StringVar(value=self.overseas_ob_root.get()),
            "trunk_sheet": StringVar(value=self.trunk_sheet_url.get()),
            "osob_sheet": StringVar(value=self.osob_sheet_url.get()),
        }
        container = ttk.Frame(
            window,
            style="App.TFrame",
            padding=(14, 12),
        )
        container.pack(fill=BOTH, expand=True)
        ttk.Label(
            container,
            text="工作区与固定表",
            style="DialogTitle.TLabel",
        ).grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 10))

        def choose_path(variable: StringVar) -> None:
            selected = filedialog.askdirectory(
                title="选择工作区根目录",
                initialdir=variable.get() or None,
                parent=window,
            )
            if selected:
                variable.set(selected)

        rows = (
            ("国内 trunk", "domestic", True),
            ("海外 trunk", "overseas", True),
            ("海外 OB", "osob", True),
            ("Trunk 固定表", "trunk_sheet", False),
            ("海外 OB 固定表", "osob_sheet", False),
        )
        for row, (label, key, is_path) in enumerate(rows, start=1):
            ttk.Label(
                container,
                text=label,
                style="Muted.TLabel",
            ).grid(row=row, column=0, sticky="w", pady=4)
            ttk.Entry(
                container,
                textvariable=values[key],
            ).grid(
                row=row,
                column=1,
                sticky="ew",
                padx=(10, 6),
                pady=4,
            )
            if is_path:
                ttk.Button(
                    container,
                    text="...",
                    width=4,
                    style="Tool.TButton",
                    command=lambda variable=values[key]: choose_path(variable),
                ).grid(row=row, column=2, pady=4)

        container.columnconfigure(1, weight=1)
        footer = ttk.Frame(container, style="App.TFrame")
        footer.grid(
            row=len(rows) + 1,
            column=0,
            columnspan=3,
            sticky="ew",
            pady=(12, 0),
        )

        def close_window() -> None:
            self.settings_window = None
            window.destroy()

        def save_settings() -> None:
            roots = tuple(
                values[key].get().strip()
                for key in ("domestic", "overseas", "osob")
            )
            if not all(roots):
                messagebox.showwarning(
                    "配置不完整",
                    "三个工作区目录都必须填写。",
                    parent=window,
                )
                return
            sheet_urls = tuple(
                values[key].get().strip()
                for key in ("trunk_sheet", "osob_sheet")
            )
            if not all(
                value
                and any(
                    marker in value
                    for marker in (
                        "/wiki/",
                        "/sheets/",
                        "/spreadsheets/",
                    )
                )
                for value in sheet_urls
            ):
                messagebox.showwarning(
                    "链接无效",
                    "请配置两个飞书 Wiki 或电子表格链接。",
                    parent=window,
                )
                return
            self.domestic_root.set(roots[0])
            self.overseas_trunk_root.set(roots[1])
            self.overseas_ob_root.set(roots[2])
            self.trunk_sheet_url.set(sheet_urls[0])
            self.osob_sheet_url.set(sheet_urls[1])
            source_role = self._workspace_role(
                self.source_workspace.get()
            )
            self._set_workspace_route(source_role, save=False)
            self.ticket_snapshots.clear()
            self.current_ticket_mapping = None
            self.current_ticket_mappings = ()
            self._save_config()
            self.status_text.set("迁移设置已保存")
            close_window()

        ttk.Button(
            footer,
            text="取消",
            style="Tool.TButton",
            command=close_window,
        ).pack(side=RIGHT)
        ttk.Button(
            footer,
            text="保存",
            style="Primary.TButton",
            command=save_settings,
        ).pack(side=RIGHT, padx=(0, 6))
        window.protocol("WM_DELETE_WINDOW", close_window)

    def _schedule_ticket_resolution(
        self,
        _event: object = None,
    ) -> None:
        if self._ticket_parse_after_id is not None:
            self.root.after_cancel(self._ticket_parse_after_id)
        self._ticket_parse_after_id = self.root.after(
            80,
            self._start_ticket_resolution,
        )

    def _start_ticket_resolution(
        self,
        event: object = None,
    ) -> str | None:
        self._ticket_parse_after_id = None
        if self.busy:
            if event is None:
                messagebox.showinfo("任务执行中", "当前任务尚未完成。")
            return "break" if event is not None else None
        issue_text = self.ticket_input.get("1.0", "end-1c").strip()
        if not issue_text:
            if event is None:
                messagebox.showwarning(
                    "缺少单号",
                    "请粘贴包含 SERIA 或 OSCOA 单号的内容。",
                )
            return "break" if event is not None else None
        sheet_url = self._table_url(self.active_table_kind)
        if not sheet_url:
            messagebox.showwarning(
                "缺少固定表",
                "请先在设置中配置对应的飞书工作簿链接。",
            )
            return "break" if event is not None else None

        snapshot = self.ticket_snapshots.get(self.active_table_kind)
        if snapshot is not None:
            resolution = resolve_ticket_text(issue_text, snapshot)
            self._apply_ticket_resolution(
                snapshot,
                resolution,
                issue_text,
            )
            return "break" if event is not None else None

        self.busy = True
        self.task_failed = False
        self.active_task = "resolve"
        self._set_action_buttons("disabled")
        self.status_text.set("读取最新页签并解析单号...")
        self._set_detail("正在从固定表识别粘贴内容。")
        threading.Thread(
            target=self._ticket_resolution_worker,
            args=(self.active_table_kind, issue_text, sheet_url),
            name="migration-ticket-resolver",
            daemon=True,
        ).start()
        return "break" if event is not None else None

    def _ticket_resolution_worker(
        self,
        table_kind: str,
        issue_text: str,
        sheet_url: str,
    ) -> None:
        try:
            snapshot = LarkTicketSheetClient(sheet_url).fetch()
            resolution = resolve_ticket_text(issue_text, snapshot)
            self.events.put(
                (
                    "ticket-resolution",
                    (table_kind, snapshot, resolution, issue_text),
                )
            )
        except Exception as exc:
            self.events.put(("error", str(exc)))
        finally:
            self.events.put(("done", "resolve"))

    def _apply_ticket_resolution(
        self,
        snapshot: TicketSheetSnapshot,
        resolution: TicketTextResolution | tuple[TicketMapping, ...],
        issue_text: str,
    ) -> None:
        if isinstance(resolution, tuple):
            resolution = TicketTextResolution(
                mappings=resolution,
                issue_keys=(),
                unresolved_keys=(),
                ambiguous_keys=(),
            )
        mappings = tuple(
            mapping
            for mapping in resolution.mappings
            if self._mapping_allowed_for_active_table(mapping)
        )
        if not mappings:
            self.current_ticket_mapping = None
            self.current_ticket_mappings = ()
            self.source_issue.set("")
            self.target_issue.set("")
            self.status_text.set("固定表中未找到可执行单号")
            details = [
                f"工作表：{snapshot.sheet_name}",
                f"输入：{issue_text}",
                "结果：未找到当前流程可执行的映射",
            ]
            if resolution.unresolved_keys:
                details.append(
                    "未识别：" + ", ".join(resolution.unresolved_keys)
                )
            if resolution.ambiguous_keys:
                details.append(
                    "映射不唯一：" + ", ".join(resolution.ambiguous_keys)
                )
            self._set_detail("\n".join(details))
            return
        self.ticket_snapshots[self.active_table_kind] = snapshot
        self._use_ticket_mappings(
            snapshot,
            mappings,
            start_audit=False,
        )
        details = [
            f"工作表：{snapshot.sheet_name}",
            f"已解析：{len(mappings)} 条",
            f"源单号：{self.source_issue.get() or '-'}",
            f"海外单号：{self.target_issue.get() or '-'}",
        ]
        if resolution.unresolved_keys:
            details.extend(
                ("", "未识别：" + ", ".join(resolution.unresolved_keys))
            )
        if resolution.ambiguous_keys:
            details.extend(
                ("", "映射不唯一：" + ", ".join(resolution.ambiguous_keys))
            )
        self._set_detail("\n".join(details))

    def _mapping_allowed_for_active_table(
        self,
        mapping: TicketMapping,
    ) -> bool:
        if self.active_table_kind == TABLE_TRUNK:
            return mapping.route == TicketRoute.DOMESTIC_TO_OVERSEAS
        return mapping.route in {
            TicketRoute.DOMESTIC_TO_OVERSEAS,
            TicketRoute.OVERSEAS_TO_OSOB,
        }

    def _use_ticket_mapping(
        self,
        snapshot: TicketSheetSnapshot,
        mapping: TicketMapping,
        *,
        start_audit: bool = False,
    ) -> None:
        self.current_ticket_mapping = mapping
        self.current_ticket_mappings = (mapping,)
        self.source_issue.set(mapping.source_issue)
        self.target_issue.set(mapping.target_issue)
        source_role = (
            WORKSPACE_OVERSEAS_TRUNK
            if mapping.route == TicketRoute.OVERSEAS_TO_OSOB
            else WORKSPACE_DOMESTIC
        )
        self._set_workspace_route(source_role)
        cache_note = "（缓存）" if snapshot.from_cache else ""
        lines = [
            f"工作表：{snapshot.sheet_name}{cache_note}",
            f"工作表版本：{snapshot.revision}",
            f"行号：{mapping.row}",
            f"路线：{mapping.route.label}",
            f"源单号：{mapping.source_issue}",
            f"目标单号：{mapping.target_issue or '-'}",
            "",
            f"源标题：{mapping.source_text or '-'}",
            f"目标标题：{mapping.target_text or '-'}",
        ]
        if snapshot.warning:
            lines.extend(("", snapshot.warning))
        self._set_detail("\n".join(lines))
        self.status_text.set(
            f"已识别：{mapping.route.label} · 第 {mapping.row} 行"
        )
        if mapping.route == TicketRoute.OSOB_ONLY:
            messagebox.showwarning(
                "仅提交 OSOB",
                "表格将该单标记为“单提 OSOB”，不应执行常规迁移核验。",
            )
        elif mapping.route == TicketRoute.SKIP:
            messagebox.showwarning(
                "不合并",
                "表格将该单标记为“不合并”。",
            )
        elif mapping.route == TicketRoute.UNKNOWN:
            messagebox.showwarning(
                "映射待确认",
                "表格中的该行不符合标准单号映射格式。",
            )
        if start_audit and self._can_auto_audit(mapping):
            self.root.after(120, self._start_audit)

    def _use_ticket_mappings(
        self,
        snapshot: TicketSheetSnapshot,
        mappings: tuple[TicketMapping, ...],
        *,
        start_audit: bool,
    ) -> None:
        if len(mappings) == 1:
            self._use_ticket_mapping(
                snapshot,
                mappings[0],
                start_audit=start_audit,
            )
            return
        self.current_ticket_mapping = None
        self.current_ticket_mappings = mappings
        source_issues = tuple(
            dict.fromkeys(item.source_issue for item in mappings)
        )
        target_issues = tuple(
            dict.fromkeys(item.target_issue for item in mappings)
        )
        self.source_issue.set(", ".join(source_issues))
        self.target_issue.set(", ".join(target_issues))
        has_domestic = any(
            item.route == TicketRoute.DOMESTIC_TO_OVERSEAS
            for item in mappings
        )
        source_role = (
            WORKSPACE_DOMESTIC
            if has_domestic
            else WORKSPACE_OVERSEAS_TRUNK
        )
        self._set_workspace_route(source_role)
        route_text = (
            "国内主干 → 海外主干 → OSOB"
            if self.active_table_kind == TABLE_OSOB and has_domestic
            else mappings[0].route.label
        )
        self._set_detail(
            "\n".join(
                (
                    f"工作表：{snapshot.sheet_name}",
                    f"路线：{route_text}",
                    f"已选择：{len(mappings)} 条任务",
                    f"源单号：{len(source_issues)} 个",
                    f"海外单号：{len(target_issues)} 个",
                    "",
                    "即将统一扫描源提交、目标状态和海外提交记录。",
                )
            )
        )
        self.status_text.set(
            f"已选择 {len(mappings)} 条，准备统一核验"
        )
        if start_audit:
            self.root.after(120, self._start_batch_audit)

    def _can_auto_audit(self, mapping: TicketMapping) -> bool:
        return mapping.route in {
            TicketRoute.DOMESTIC_TO_OVERSEAS,
            TicketRoute.OVERSEAS_TO_OSOB,
        }

    def _active_stage_mappings(self) -> tuple[TicketMapping, ...]:
        source_role = self._workspace_role(self.source_workspace.get())
        if source_role == WORKSPACE_OVERSEAS_TRUNK:
            return as_overseas_to_osob(self.current_ticket_mappings)
        return tuple(
            mapping
            for mapping in self.current_ticket_mappings
            if mapping.route == TicketRoute.DOMESTIC_TO_OVERSEAS
        )

    def _start_update_and_audit(self) -> None:
        if self._current_mapping_selection_is_valid():
            self._start_batch_background(update_first=True)
            return
        self._start_background("更新工作区", self._update_and_audit)

    def _start_audit(self) -> None:
        if self._current_mapping_selection_is_valid():
            self._start_batch_audit()
            return
        self._start_background("核验迁移", self._audit)

    def _current_mapping_selection_is_valid(self) -> bool:
        if not self.current_ticket_mappings:
            return False
        source_value = ", ".join(
            dict.fromkeys(
                item.source_issue
                for item in self.current_ticket_mappings
            )
        )
        target_value = ", ".join(
            dict.fromkeys(
                item.target_issue
                for item in self.current_ticket_mappings
            )
        )
        return (
            self.source_issue.get().strip() == source_value
            and self.target_issue.get().strip() == target_value
        )

    def _start_batch_audit(self) -> None:
        self._start_batch_background(update_first=False)

    def _start_batch_background(self, *, update_first: bool) -> None:
        if self.busy:
            messagebox.showinfo("任务执行中", "当前任务尚未完成。")
            return
        mappings = self._active_stage_mappings()
        if not mappings:
            messagebox.showwarning(
                "没有任务",
                "当前工作区路线没有可执行任务。",
            )
            return
        try:
            modules = self._selected_modules()
            lookback_days = int(self.lookback_days.get())
            include_externals = self.include_externals.get()
            self._save_config()
        except (ValueError, OSError) as exc:
            messagebox.showwarning("无法开始", str(exc))
            return
        self.busy = True
        self.task_failed = False
        self.active_task = "audit"
        self.current_result = None
        self._set_action_buttons("disabled")
        label = "批量更新并核验" if update_first else "批量核验"
        self.status_text.set(f"{label}中...")
        self._set_detail(
            f"{label}：{len(mappings)} 条任务，请稍候。"
        )
        self._show_progress_row(
            f"{label}：准备 {len(mappings)} 条任务"
        )
        threading.Thread(
            target=self._run_batch_background,
            args=(
                modules,
                mappings,
                lookback_days,
                include_externals,
                update_first,
            ),
            name="migration-batch-worker",
            daemon=True,
        ).start()

    def _run_batch_background(
        self,
        modules: tuple[WorkspaceModule, ...],
        mappings: tuple[TicketMapping, ...],
        lookback_days: int,
        include_externals: bool,
        update_first: bool,
    ) -> None:
        try:
            if update_first:
                folders = [
                    path
                    for module in modules
                    for path in (module.source_path, module.target_path)
                ]
                update_result = MigrationUpdateClient(
                    log=self._queue_log,
                ).update_folders(folders)
                self.events.put(("update-result", update_result))
                if not update_result.get("ok"):
                    raise RuntimeError(
                        str(
                            update_result.get(
                                "message",
                                "工作区更新未全部成功",
                            )
                        )
                    )
            service = MigrationAuditService(
                svn=SvnClient(log=self._queue_log),
                progress=lambda stage, message: self.events.put(
                    ("progress", (stage, message))
                ),
                include_externals=include_externals,
            )
            result = service.audit_batch(
                modules,
                tuple(
                    MigrationCase(
                        item.source_issue,
                        item.target_issue,
                        item.target_text or item.source_text,
                    )
                    for item in mappings
                ),
                lookback_days=lookback_days,
            )
            self.events.put(("audit-result", result))
        except Exception as exc:
            self.events.put(("error", str(exc)))
        finally:
            self.events.put(("done", "audit"))

    def _start_batch_migration(self) -> None:
        if self.busy:
            messagebox.showinfo("任务执行中", "当前任务尚未完成。")
            return
        if not isinstance(self.current_result, BatchMigrationAuditResult):
            messagebox.showwarning(
                "缺少批量清单",
                "请先从合并表选择任务并完成统一核验。",
            )
            return
        stage_mappings = self._active_stage_mappings()
        if not stage_mappings:
            messagebox.showwarning("没有任务", "请先从合并表选择任务。")
            return
        try:
            modules = self._selected_modules()
            lookback_days = int(self.lookback_days.get())
            include_externals = self.include_externals.get()
            target_branch_dir = Path(self.target_root.get())
            expected_cases = {
                (item.source_issue, item.target_issue)
                for item in stage_mappings
            }
            actual_cases = {
                (item.source_issue, item.target_issue)
                for item in self.current_result.cases
            }
            if expected_cases != actual_cases:
                raise ValueError("工作区路线已变化，请先重新核验")
            preview = BatchMigrationExecutor().build_asset_plan(
                self.current_result,
                modules,
            )
            source_role = self._workspace_role(
                self.source_workspace.get()
            )
            cascade = (
                self.active_table_kind == TABLE_OSOB
                and source_role == WORKSPACE_DOMESTIC
                and any(
                    item.route == TicketRoute.DOMESTIC_TO_OVERSEAS
                    for item in self.current_ticket_mappings
                )
            )
            osob_mappings = (
                as_overseas_to_osob(self.current_ticket_mappings)
                if cascade
                else ()
            )
            osob_modules = (
                self._selected_modules_for_roots(
                    self.overseas_trunk_root.get().strip(),
                    self.overseas_ob_root.get().strip(),
                )
                if cascade
                else ()
            )
            first_stage_label = (
                "海外 trunk → OSOB"
                if source_role == WORKSPACE_OVERSEAS_TRUNK
                else "国内 trunk → 海外 trunk"
            )
            osob_target_dir = Path(self.overseas_ob_root.get())
            self._save_config()
        except (ValueError, OSError) as exc:
            messagebox.showwarning("无法开始", str(exc))
            return
        selected_packages = self._choose_migration_assets(
            preview,
            title=(
                "第一阶段：国内 trunk → 海外 trunk"
                if cascade
                else "选择迁移内容"
            ),
        )
        if selected_packages is None:
            return

        self.busy = True
        self.task_failed = False
        self.active_task = "migration"
        self._set_action_buttons("disabled")
        self.status_text.set("批量迁移：重新确认源清单")
        self._set_detail(
            f"批量流水线已启动：{len(stage_mappings)} 条任务。"
        )
        self._show_progress_row(
            f"统一预检 {len(stage_mappings)} 条任务",
            stage="preflight",
        )
        threading.Thread(
            target=self._run_batch_migration_background,
            args=(
                modules,
                stage_mappings,
                lookback_days,
                include_externals,
                target_branch_dir,
                selected_packages,
                osob_modules,
                osob_mappings,
                first_stage_label,
                osob_target_dir,
            ),
            name="migration-pipeline-worker",
            daemon=True,
        ).start()

    def _run_batch_migration_background(
        self,
        modules: tuple[WorkspaceModule, ...],
        mappings: tuple[TicketMapping, ...],
        lookback_days: int,
        include_externals: bool,
        target_branch_dir: Path,
        selected_packages: tuple[str, ...],
        osob_modules: tuple[WorkspaceModule, ...],
        osob_mappings: tuple[TicketMapping, ...],
        first_stage_label: str,
        osob_target_dir: Path,
    ) -> None:
        progress = lambda stage, message: self.events.put(
            ("progress", (stage, message))
        )
        cases = tuple(
            MigrationCase(
                item.source_issue,
                item.target_issue,
                item.target_text or item.source_text,
            )
            for item in mappings
        )
        try:
            final_result, first_summary = self._execute_migration_stage(
                modules,
                cases,
                mappings,
                selected_packages,
                target_branch_dir,
                lookback_days=lookback_days,
                include_externals=include_externals,
                stage_label=first_stage_label,
            )
            self.events.put(("audit-result", final_result))
            summaries = [first_summary]
            if osob_mappings:
                if not final_result.complete:
                    self.events.put(
                        (
                            "workflow-summary",
                            {
                                "stages": tuple(summaries),
                                "halted": "第一阶段复核未通过，未执行 OSOB 阶段",
                            },
                        )
                    )
                    return
                self.events.put(
                    ("workspace-stage", WORKSPACE_OVERSEAS_TRUNK)
                )
                osob_cases = tuple(
                    MigrationCase(
                        item.source_issue,
                        item.target_issue,
                        item.target_text or item.source_text,
                    )
                    for item in osob_mappings
                )
                osob_audit = MigrationAuditService(
                    svn=SvnClient(log=self._queue_log),
                    progress=progress,
                    include_externals=include_externals,
                )
                progress(
                    "osob-preflight",
                    "第一阶段已完成，检查海外 trunk → OSOB",
                )
                osob_preflight = osob_audit.audit_batch(
                    osob_modules,
                    osob_cases,
                    lookback_days=lookback_days,
                )
                osob_plan = BatchMigrationExecutor().build_asset_plan(
                    osob_preflight,
                    osob_modules,
                )
                osob_selection = self._request_asset_selection(
                    osob_plan,
                    "第二阶段：海外 trunk → OSOB",
                )
                if osob_selection is None:
                    self.events.put(("pipeline-cancelled", None))
                    return
                final_result, osob_summary = self._execute_migration_stage(
                    osob_modules,
                    osob_cases,
                    osob_mappings,
                    osob_selection,
                    osob_target_dir,
                    lookback_days=lookback_days,
                    include_externals=include_externals,
                    stage_label="海外 trunk → OSOB",
                    preflight=osob_preflight,
                )
                summaries.append(osob_summary)
                self.events.put(("audit-result", final_result))
            self.events.put(
                (
                    "workflow-summary",
                    {
                        "stages": tuple(summaries),
                        "halted": "",
                    },
                )
            )
        except Exception as exc:
            self.events.put(("error", str(exc)))
        finally:
            self.events.put(("done", "migration"))

    def _execute_migration_stage(
        self,
        modules: tuple[WorkspaceModule, ...],
        cases: tuple[MigrationCase, ...],
        mappings: tuple[TicketMapping, ...],
        selected_packages: tuple[str, ...],
        target_branch_dir: Path,
        *,
        lookback_days: int,
        include_externals: bool,
        stage_label: str,
        preflight: BatchMigrationAuditResult | None = None,
    ) -> tuple[BatchMigrationAuditResult, dict[str, object]]:
        progress = lambda stage, message: self.events.put(
            ("progress", (stage, f"{stage_label}：{message}"))
        )
        audit = MigrationAuditService(
            svn=SvnClient(log=self._queue_log),
            progress=progress,
            include_externals=include_externals,
        )
        progress("preflight", "统一确认源提交和目标状态")
        if preflight is None:
            preflight = audit.audit_batch(
                modules,
                cases,
                lookback_days=lookback_days,
            )
        executor = BatchMigrationExecutor(progress=progress)
        migration_plan = executor.build_asset_plan(preflight, modules)
        migration_plan = executor.select_assets(
            migration_plan,
            selected_packages,
        )
        executor.migrate(
            migration_plan,
            modules,
            target_branch_dir=target_branch_dir,
        )

        progress("checkout-scan", "检查迁移后的目标改动")
        after_migration = audit.audit_batch(
            modules,
            cases,
            lookback_days=lookback_days,
        )
        checkout_plan = executor.build_checkout_plan(
            after_migration,
            {
                item.target_issue: _ticket_commit_message(item)
                for item in mappings
            },
        )
        if checkout_plan.ambiguous_paths:
            progress(
                "checkout",
                "检测到跨 Jira 共享文件，跳过自动提交分组",
            )
            launch_result = None
        else:
            launch_result = executor.open_checkout_windows(
                checkout_plan,
                wait=True,
            )

        progress("verify", "比对源清单、目标状态和提交记录")
        final_result = audit.audit_batch(
            modules,
            cases,
            lookback_days=lookback_days,
        )
        return final_result, {
            "label": stage_label,
            "assets": len(migration_plan.assets),
            "manual": len(migration_plan.manual_files),
            "checkout_groups": len(checkout_plan.groups),
            "checkout_paths": checkout_plan.path_count,
            "ambiguous": len(checkout_plan.ambiguous_paths),
            "opened": (
                len(launch_result.opened_groups)
                if launch_result is not None
                else 0
            ),
            "complete": final_result.complete,
        }

    def _request_asset_selection(
        self,
        plan: AssetMigrationPlan,
        title: str,
    ) -> tuple[str, ...] | None:
        response: queue.Queue[tuple[str, ...] | None] = queue.Queue(
            maxsize=1
        )
        self.events.put(
            ("asset-selection-request", (plan, title, response))
        )
        return response.get()

    def _choose_migration_assets(
        self,
        plan: AssetMigrationPlan,
        *,
        title: str = "选择迁移内容",
    ) -> tuple[str, ...] | None:
        window = Toplevel(self.root)
        window.withdraw()
        window.title(title)
        window.geometry("900x540")
        window.minsize(720, 420)
        window.transient(self.root)
        if APP_ICON_PATH.is_file():
            try:
                window.iconbitmap(default=str(APP_ICON_PATH))
            except Exception:
                pass

        container = ttk.Frame(
            window,
            style="App.TFrame",
            padding=(14, 12),
        )
        container.pack(fill=BOTH, expand=True)
        header = ttk.Frame(container, style="App.TFrame")
        header.pack(fill=X, pady=(0, 8))
        ttk.Label(
            header,
            text=title,
            style="DialogTitle.TLabel",
        ).pack(side=LEFT)
        selection_text = StringVar()
        ttk.Label(
            header,
            textvariable=selection_text,
            style="Muted.TLabel",
        ).pack(side=RIGHT)

        tree_model = AssetTreeSelection(plan.assets)
        columns = ("source", "target")
        table_frame = ttk.Frame(container, style="Panel.TFrame", padding=1)
        table_frame.pack(fill=BOTH, expand=True)
        table = ttk.Treeview(
            table_frame,
            columns=columns,
            show="tree headings",
            selectmode="browse",
        )
        table.heading("#0", text="项目中的位置")
        table.column(
            "#0",
            width=500,
            minwidth=360,
            stretch=True,
            anchor="w",
        )
        for name, title, width in (
            ("source", "源单号", 145),
            ("target", "海外单号", 145),
        ):
            table.heading(name, text=title)
            table.column(
                name,
                width=width,
                minwidth=width,
                stretch=False,
                anchor="w",
            )
        table.tag_configure(
            "folder",
            foreground="#344054",
            font=("Segoe UI Semibold", 10),
        )
        table.tag_configure("asset", foreground="#1F2937")

        state_markers = {
            CHECKED: "[x]",
            PARTIAL: "[-]",
        }

        def node_text(node_id: str) -> str:
            node = tree_model.nodes[node_id]
            marker = state_markers.get(
                tree_model.state(node_id),
                "[ ]",
            )
            if node.is_asset:
                return f"{marker} {node.name}"
            return (
                f"{marker} {node.name}"
                f" ({tree_model.asset_count(node_id)})"
            )

        def insert_node(parent_id: str, node_id: str) -> None:
            node = tree_model.nodes[node_id]
            table.insert(
                parent_id,
                END,
                iid=node_id,
                text=node_text(node_id),
                values=(
                    "、".join(node.source_issues) if node.is_asset else "",
                    "、".join(node.target_issues) if node.is_asset else "",
                ),
                open=not node.is_asset,
                tags=("asset" if node.is_asset else "folder",),
            )
            for child_id in node.children:
                insert_node(node_id, child_id)

        for root_id in tree_model.root_ids:
            insert_node("", root_id)
        y_scroll = ttk.Scrollbar(
            table_frame,
            orient=VERTICAL,
            command=table.yview,
        )
        x_scroll = ttk.Scrollbar(
            table_frame,
            orient=HORIZONTAL,
            command=table.xview,
        )
        table.configure(
            yscrollcommand=y_scroll.set,
            xscrollcommand=x_scroll.set,
        )
        table.grid(row=0, column=0, sticky="nsew")
        y_scroll.grid(row=0, column=1, sticky="ns")
        x_scroll.grid(row=1, column=0, sticky="ew")
        table_frame.rowconfigure(0, weight=1)
        table_frame.columnconfigure(0, weight=1)

        note = (
            f"可迁移 {len(plan.assets)} 个"
            f" · 人工处理 {len(plan.manual_files)} 个"
            f" · 已有证据 {plan.already_handled_count} 个"
        )
        ttk.Label(
            container,
            text=note,
            style="Muted.TLabel",
        ).pack(fill=X, pady=(8, 0))
        detail_text = StringVar(
            value=(
                "选择目录或资源查看完整项目路径"
                if plan.assets
                else "没有需要自动迁移的 UE 资源"
            )
        )
        ttk.Label(
            container,
            textvariable=detail_text,
            style="Muted.TLabel",
            wraplength=840,
        ).pack(fill=X, pady=(3, 0))

        footer = ttk.Frame(container, style="App.TFrame")
        footer.pack(fill=X, pady=(8, 0))
        result: tuple[str, ...] | None = None

        def selected_packages() -> tuple[str, ...]:
            return tree_model.selected_packages()

        def refresh_selection(_event: object = None) -> None:
            for node_id in tree_model.nodes:
                if table.exists(node_id):
                    table.item(node_id, text=node_text(node_id))
            count = len(tree_model.selected_packages())
            folder_count = tree_model.selected_folder_count()
            selection_text.set(
                f"已选 {count} / {len(plan.assets)}"
                f" · {folder_count} 个目录"
            )
            confirm_button.configure(
                text=f"迁移选中（{count}）"
                if count
                else "继续（不迁移资源）"
            )

        def refresh_detail(_event: object = None) -> None:
            selection = table.selection()
            node_id = selection[0] if selection else table.focus()
            if not node_id or node_id not in tree_model.nodes:
                return
            node = tree_model.nodes[node_id]
            if node.is_asset:
                detail_text.set(
                    f"{node.path} · "
                    f"{'、'.join(node.source_issues)} → "
                    f"{'、'.join(node.target_issues)}"
                )
            else:
                detail_text.set(
                    f"{node.path} · "
                    f"{tree_model.asset_count(node_id)} 个候选资源"
                )

        def toggle_node(node_id: str) -> None:
            if node_id not in tree_model.nodes:
                return
            tree_model.toggle(node_id)
            refresh_selection()
            refresh_detail()

        def toggle_pointer(event: object) -> str | None:
            row_id = table.identify_row(getattr(event, "y", 0))
            if not row_id:
                return None
            element = table.identify_element(
                getattr(event, "x", 0),
                getattr(event, "y", 0),
            )
            if "indicator" in element:
                return None
            table.selection_set(row_id)
            table.focus(row_id)
            toggle_node(row_id)
            return "break"

        def toggle_focused(_event: object = None) -> str:
            node_id = table.focus()
            if node_id:
                toggle_node(node_id)
            return "break"

        def select_all() -> None:
            tree_model.select_all()
            refresh_selection()

        def clear_selection() -> None:
            tree_model.clear()
            refresh_selection()

        def confirm() -> None:
            nonlocal result
            result = selected_packages()
            window.destroy()

        def cancel() -> None:
            window.destroy()

        ttk.Button(
            footer,
            text="取消",
            style="Tool.TButton",
            command=cancel,
        ).pack(side=RIGHT)
        confirm_button = ttk.Button(
            footer,
            text="迁移选中",
            style="Primary.TButton",
            command=confirm,
        )
        confirm_button.pack(side=RIGHT, padx=(0, 6))
        ttk.Button(
            footer,
            text="清空",
            style="Tool.TButton",
            command=clear_selection,
        ).pack(side=LEFT)
        ttk.Button(
            footer,
            text="全选",
            style="Tool.TButton",
            command=select_all,
        ).pack(side=LEFT, padx=(0, 6))

        table.bind("<Button-1>", toggle_pointer)
        table.bind("<space>", toggle_focused)
        table.bind("<<TreeviewSelect>>", refresh_detail)
        window.bind("<Escape>", lambda _event: cancel())
        window.protocol("WM_DELETE_WINDOW", cancel)
        select_all()
        self.root.update_idletasks()
        width = 900
        height = 540
        x = max(
            0,
            self.root.winfo_rootx()
            + (self.root.winfo_width() - width) // 2,
        )
        y = max(
            0,
            self.root.winfo_rooty()
            + (self.root.winfo_height() - height) // 2,
        )
        window.geometry(f"{width}x{height}+{x}+{y}")
        window.deiconify()
        window.lift()
        window.focus_force()
        window.grab_set()
        self.root.wait_window(window)
        return result


    def _start_background(
        self,
        label: str,
        action: Callable[
            [tuple[WorkspaceModule, ...], str, str, int, bool],
            None,
        ],
    ) -> None:
        if self.busy:
            messagebox.showinfo("任务执行中", "当前任务尚未完成。")
            return
        try:
            modules = self._selected_modules()
            source_issue = self.source_issue.get().strip()
            target_issue = self.target_issue.get().strip()
            if not source_issue or not target_issue:
                raise ValueError(
                    "请先粘贴并解析包含 SERIA 或 OSCOA 单号的内容"
                )
            mapping = self.current_ticket_mapping
            if (
                mapping is not None
                and source_issue == mapping.source_issue
                and target_issue == mapping.target_issue
                and mapping.route in {
                    TicketRoute.OSOB_ONLY,
                    TicketRoute.SKIP,
                }
            ):
                raise ValueError(
                    f"合并表将该单标记为“{mapping.route.label}”"
                )
            lookback_days = int(self.lookback_days.get())
            include_externals = self.include_externals.get()
            self._save_config()
        except (ValueError, OSError) as exc:
            messagebox.showwarning("无法开始", str(exc))
            return

        self.busy = True
        self.task_failed = False
        self.active_task = "audit"
        self.current_result = None
        self._set_action_buttons("disabled")
        self.status_text.set(f"{label}中...")
        self._set_detail(f"{label}中，请稍候。")
        self._show_progress_row(f"{label}：准备中")
        threading.Thread(
            target=self._run_background,
            args=(
                action,
                modules,
                source_issue,
                target_issue,
                lookback_days,
                include_externals,
            ),
            name="migration-guard-worker",
            daemon=True,
        ).start()

    def _run_background(
        self,
        action: Callable[
            [tuple[WorkspaceModule, ...], str, str, int, bool],
            None,
        ],
        modules: tuple[WorkspaceModule, ...],
        source_issue: str,
        target_issue: str,
        lookback_days: int,
        include_externals: bool,
    ) -> None:
        try:
            action(
                modules,
                source_issue,
                target_issue,
                lookback_days,
                include_externals,
            )
        except Exception as exc:
            self.events.put(("error", str(exc)))
        finally:
            self.events.put(("done", "audit"))

    def _update_and_audit(
        self,
        modules: tuple[WorkspaceModule, ...],
        source_issue: str,
        target_issue: str,
        lookback_days: int,
        include_externals: bool,
    ) -> None:
        folders = [
            path
            for module in modules
            for path in (module.source_path, module.target_path)
        ]
        update_result = MigrationUpdateClient(
            log=self._queue_log,
        ).update_folders(folders)
        self.events.put(("update-result", update_result))
        if not update_result.get("ok"):
            raise RuntimeError(
                str(
                    update_result.get(
                        "message",
                        "工作区更新未全部成功",
                    )
                )
            )
        self._audit(
            modules,
            source_issue,
            target_issue,
            lookback_days,
            include_externals,
        )

    def _audit(
        self,
        modules: tuple[WorkspaceModule, ...],
        source_issue: str,
        target_issue: str,
        lookback_days: int,
        include_externals: bool,
    ) -> None:
        service = MigrationAuditService(
            svn=SvnClient(log=self._queue_log),
            progress=lambda stage, message: self.events.put(
                ("progress", (stage, message))
            ),
            include_externals=include_externals,
        )
        result = service.audit(
            modules,
            source_issue,
            target_issue,
            lookback_days=lookback_days,
        )
        self.events.put(("audit-result", result))

    def _queue_log(self, message: str) -> None:
        self.events.put(("log", message))

    def _set_action_buttons(self, state: str) -> None:
        self.update_button.configure(state=state)
        self.audit_button.configure(state=state)
        self.migrate_button.configure(state=state)
        self.resolve_button.configure(state=state)
        self.trunk_table_button.configure(state=state)
        self.osob_table_button.configure(state=state)
        self.sheet_config_button.configure(state=state)
        if state == "normal":
            self._update_migrate_button_state()

    def _update_migrate_button_state(self) -> None:
        enabled = (
            not self.busy
            and isinstance(
                self.current_result,
                BatchMigrationAuditResult,
            )
            and bool(self.current_ticket_mappings)
        )
        self.migrate_button.configure(
            state="normal" if enabled else "disabled"
        )

    def _configure_audit_table(self) -> None:
        headings = {
            "state": "状态",
            "module": "模块",
            "path": "相对路径",
            "source": "源版本",
            "local": "目标本地",
            "target": "海外提交",
        }
        widths = {
            "state": 76,
            "module": 58,
            "path": 330,
            "source": 96,
            "local": 86,
            "target": 100,
        }
        for name in self.table["columns"]:
            self.table.heading(name, text=headings[name])
            self.table.column(
                name,
                width=widths[name],
                minwidth=widths[name],
                stretch=name == "path",
                anchor="w" if name == "path" else "center",
            )
        self.table_mode = "audit"
        self.use_ticket_button.configure(state="disabled")
        self.open_path_button.configure(state="normal")

    def _show_progress_row(
        self,
        message: str,
        *,
        state: str = "进行中",
        stage: str = "",
    ) -> None:
        if self.table_mode != "audit":
            self._configure_audit_table()
        progress_id = "__progress__"
        values = (state, stage, message, "", "", "")
        if self.table.exists(progress_id):
            self.table.item(progress_id, values=values)
            return
        self.table.delete(*self.table.get_children())
        self.visible_files = []
        self.table.insert(
            "",
            END,
            iid=progress_id,
            values=values,
        )

    def _poll_events(self) -> None:
        try:
            while True:
                event, payload = self.events.get_nowait()
                if event == "progress":
                    stage, message = payload
                    self.status_text.set(str(message))
                    if self.active_task in {"audit", "migration"}:
                        self._show_progress_row(
                            str(message),
                            stage=str(stage),
                        )
                elif event == "log":
                    self.status_text.set(str(payload)[:120])
                    if self.active_task in {"audit", "migration"}:
                        self._show_progress_row(str(payload)[:160])
                elif event == "update-result":
                    result = payload
                    owner = (
                        "SVNmate"
                        if result.get("executed_by") == "svnmate"
                        else "内置核心"
                    )
                    self.status_text.set(f"{owner}更新完成")
                    self._show_progress_row(f"{owner}更新完成")
                elif event == "audit-result":
                    self.current_result = payload
                    self._render_result(payload)
                elif event == "workflow-summary":
                    summary = payload
                    lines = ["批量流水线完成", ""]
                    for stage in summary["stages"]:
                        lines.extend(
                            (
                                str(stage["label"]),
                                f"迁移：{stage['assets']} 个 UE 资源",
                                f"人工处理：{stage['manual']} 个文件",
                                f"提交分组：{stage['checkout_groups']} 个",
                                f"待提交路径：{stage['checkout_paths']} 个",
                                f"已打开窗口：{stage['opened']} 个",
                                f"归属冲突：{stage['ambiguous']} 个",
                                f"复核：{'通过' if stage['complete'] else '待处理'}",
                                "",
                            )
                        )
                    if summary["halted"]:
                        lines.append(str(summary["halted"]))
                    else:
                        lines.append("最终状态以文件表和提交版本为准。")
                    self._set_detail(
                        "\n".join(lines)
                    )
                elif event == "ticket-resolution":
                    table_kind, snapshot, resolution, issue_text = payload
                    self.active_table_kind = table_kind
                    self._apply_ticket_resolution(
                        snapshot,
                        resolution,
                        issue_text,
                    )
                elif event == "ticket-table":
                    table_kind, snapshot = payload
                    self._show_ticket_table(snapshot, table_kind)
                elif event == "workspace-stage":
                    self._set_workspace_route(str(payload))
                elif event == "asset-selection-request":
                    plan, title, response = payload
                    response.put(
                        self._choose_migration_assets(
                            plan,
                            title=str(title),
                        )
                    )
                elif event == "pipeline-cancelled":
                    self.task_failed = True
                    self.status_text.set("第二阶段已取消")
                elif event == "error":
                    self.task_failed = True
                    self.status_text.set("执行失败")
                    if self.active_task in {"audit", "migration"}:
                        self._show_progress_row(
                            str(payload),
                            state="失败",
                        )
                    self._set_detail(str(payload))
                    messagebox.showerror("执行失败", str(payload))
                elif event == "done":
                    self.busy = False
                    finished_task = self.active_task
                    self.active_task = ""
                    self._set_action_buttons("normal")
                    if (
                        finished_task == "audit"
                        and payload == "audit"
                        and not self.task_failed
                        and self.current_result is not None
                    ):
                        self.status_text.set(
                            "核验完成"
                            if self.current_result.complete
                            else "核验完成，存在待处理项"
                        )
                    elif (
                        finished_task == "migration"
                        and payload == "migration"
                        and not self.task_failed
                        and self.current_result is not None
                    ):
                        self.status_text.set(
                            "批量迁移与复核完成"
                            if self.current_result.complete
                            else "批量迁移完成，仍有待处理项"
                        )
        except queue.Empty:
            pass
        self.root.after(UI_POLL_MS, self._poll_events)

    def _render_result(
        self,
        result: MigrationAuditResult | BatchMigrationAuditResult,
    ) -> None:
        self._configure_audit_table()
        self.ticket_snapshot = None
        self.visible_ticket_mappings = []
        counts = result.counts
        self.summary_text["all"].set(str(len(result.files)))
        for state in VerificationState:
            self.summary_text[state.value].set(
                str(counts.get(state.value, 0))
            )
        self.export_button.configure(state="normal")
        self._update_migrate_button_state()
        self._refresh_table()
        if result.warnings:
            self._set_detail("\n".join(result.warnings))
        elif not result.files:
            self._set_detail("没有找到需要核验的文件。")

    def _refresh_table(self) -> None:
        if self.table_mode == "tickets":
            return
        self.table.delete(*self.table.get_children())
        self.visible_files = []
        if self.current_result is None:
            return
        selected_filter = self.filter_state.get()
        for item in self.current_result.files:
            if (
                selected_filter != "全部"
                and item.state.label != selected_filter
            ):
                continue
            relative_path = _display_relative_path(
                item.expected.target_local_path,
                self.target_root.get(),
            )
            source_revisions = ",".join(
                f"r{revision}"
                for revision in item.expected.source_revisions
            )
            target_revisions = ",".join(
                f"r{revision}"
                for revision in item.target_revisions
            ) or "-"
            index = len(self.visible_files)
            self.visible_files.append(item)
            self.table.insert(
                "",
                END,
                iid=str(index),
                values=(
                    item.state.label,
                    item.expected.module,
                    relative_path,
                    source_revisions,
                    item.local_status,
                    target_revisions,
                ),
                tags=(item.state.value,),
            )

    def _selected_item(self) -> FileVerification | None:
        if self.table_mode != "audit":
            return None
        selection = self.table.selection()
        if not selection:
            return None
        try:
            return self.visible_files[int(selection[0])]
        except (ValueError, IndexError):
            return None

    def _selected_tickets(self) -> tuple[TicketMapping, ...]:
        if self.table_mode != "tickets":
            return ()
        selection = self.table.selection()
        if not selection:
            children = self.table.get_children()
            if not children:
                return ()
            selection = (children[0],)
            self.table.selection_set(children[0])
            self.table.focus(children[0])
        result = []
        for item_id in selection:
            try:
                result.append(self.visible_ticket_mappings[int(item_id)])
            except (ValueError, IndexError):
                continue
        return tuple(result)

    def _selected_ticket(self) -> TicketMapping | None:
        selected = self._selected_tickets()
        return selected[0] if selected else None

    def _use_selected_ticket(self) -> None:
        mappings = self._selected_tickets()
        snapshot = self.ticket_snapshot
        if not mappings or snapshot is None:
            self.status_text.set("当前没有可用任务")
            return
        routes = {mapping.route for mapping in mappings}
        if len(routes) != 1 and self.active_table_kind != TABLE_OSOB:
            self.status_text.set("不能混合不同迁移路线")
            messagebox.showwarning(
                "路线不一致",
                "请只选择同一种路线的任务后再统一核验。",
            )
            return
        blocked_routes = routes & {
            TicketRoute.OSOB_ONLY,
            TicketRoute.SKIP,
            TicketRoute.UNKNOWN,
        }
        if blocked_routes:
            route = next(iter(blocked_routes))
            messagebox.showwarning(
                route.label,
                f"所选任务属于“{route.label}”，不执行常规迁移核验。",
            )
            return
        self._use_ticket_mappings(
            snapshot,
            mappings,
            start_audit=True,
        )

    def _on_table_double_click(self, event: object = None) -> None:
        if self.table_mode == "tickets":
            self._use_selected_ticket()
            return
        self._copy_selected_path(event)

    def _show_selected_detail(self, _event: object = None) -> None:
        if self.table_mode == "tickets":
            mappings = self._selected_tickets()
            if not mappings:
                return
            mapping = mappings[0]
            self.use_ticket_button.configure(
                text=f"核验选中（{len(mappings)}）"
            )
            self._set_detail(
                "\n".join(
                    (
                        f"已选择：{len(mappings)} 条",
                        f"路线：{mapping.route.label}",
                        f"表格行：{mapping.row}",
                        f"源单号：{mapping.source_issue}",
                        f"目标单号：{mapping.target_issue or '-'}",
                        "",
                        f"源标题：{mapping.source_text or '-'}",
                        f"目标标题：{mapping.target_text or '-'}",
                        "",
                        "点击“核验选中”后统一扫描并显示进度。",
                    )
                )
            )
            return
        item = self._selected_item()
        if item is None:
            return
        expected = item.expected
        content = "\n".join(
            (
                f"状态：{item.state.label}",
                f"原因：{item.reason}",
                "",
                f"源单号：{expected.source_issue}",
                f"目标单号：{expected.target_issue}",
                f"模块：{expected.module}",
                f"源动作：{expected.action}",
                f"源路径：{expected.source_path}",
                f"源本地：{expected.source_local_path}",
                f"源版本：{', '.join(f'r{x}' for x in expected.source_revisions)}",
                f"源作者：{', '.join(expected.source_authors) or '-'}",
                "",
                f"目标路径：{expected.target_path or '-'}",
                f"目标本地：{expected.target_local_path or '-'}",
                f"目标状态：{item.local_status}",
                f"远端状态：{item.repository_status or 'normal'}",
                f"目标版本：{', '.join(f'r{x}' for x in item.target_revisions) or '-'}",
                f"SVN external：{'是' if expected.is_external else '否'}",
            )
        )
        self._set_detail(content)

    def _copy_selected_path(self, _event: object = None) -> None:
        item = self._selected_item()
        if item is None or not item.expected.target_local_path:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(item.expected.target_local_path)
        self.status_text.set("目标路径已复制")

    def _open_selected_path(self) -> None:
        item = self._selected_item()
        if item is None or not item.expected.target_local_path:
            return
        path = Path(item.expected.target_local_path)
        target = path if path.exists() else path.parent
        if not target.exists():
            messagebox.showwarning("路径不存在", str(path))
            return
        if os.name == "nt" and path.exists() and path.is_file():
            subprocess.Popen(["explorer", "/select,", str(path)])
        elif os.name == "nt":
            os.startfile(str(target))

    def _set_detail(self, value: str) -> None:
        self.detail.configure(state="normal")
        self.detail.delete("1.0", END)
        self.detail.insert("1.0", value)
        self.detail.configure(state="disabled")

    def _export_result(self) -> None:
        if self.current_result is None:
            return
        if isinstance(self.current_result, BatchMigrationAuditResult):
            default_name = (
                f"batch_{len(self.current_result.cases)}_migration_audit.json"
            )
        else:
            default_name = (
                f"{self.current_result.source_issue}_"
                f"{self.current_result.target_issue}.json"
            )
        target = filedialog.asksaveasfilename(
            title="导出核验结果",
            defaultextension=".json",
            filetypes=(("JSON", "*.json"), ("所有文件", "*.*")),
            initialfile=default_name,
        )
        if not target:
            return
        Path(target).write_text(
            json.dumps(
                self.current_result.to_dict(),
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self.status_text.set("核验结果已导出")

    def _on_close(self) -> None:
        if self.busy and not messagebox.askyesno(
            "任务执行中",
            "核验任务仍在执行，确定要退出吗？",
        ):
            return
        self._save_config()
        self.root.destroy()


def _display_relative_path(path: str, root: str) -> str:
    if not path:
        return "-"
    try:
        return str(Path(path).resolve().relative_to(Path(root).resolve()))
    except (OSError, ValueError):
        return path


def _ticket_commit_message(mapping: TicketMapping) -> str:
    title = mapping.target_text.strip()
    if mapping.target_issue.casefold() in title.casefold():
        return title
    if title:
        return f"【{mapping.target_issue}】{title}"
    return f"【{mapping.target_issue}】"


def main() -> None:
    _enable_windows_dpi_awareness()
    root = Tk()
    MigrationGuardApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
