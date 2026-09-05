from __future__ import annotations

import ctypes
import os
import queue
import re
import subprocess
import sys
import threading
from collections.abc import Callable
from datetime import date, datetime, timedelta
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
    Menu,
    StringVar,
    Text,
    Tk,
    Toplevel,
    filedialog,
    messagebox,
)
from tkinter import font as tkfont
from tkinter import ttk

from .asset_tree import (
    CHECKED,
    PARTIAL,
    AssetProgressTree,
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
from .jira_client import (
    JiraIssueClient,
    TicketJiraProgress,
    build_ticket_progress,
)
from .models import (
    BatchMigrationAuditResult,
    FileVerification,
    MigrationCase,
    MigrationAuditResult,
    VerificationState,
    WorkspaceModule,
)
from .remote_asset_progress import (
    BranchEvidence,
    RemoteAssetProgress,
    RemoteAssetProgressCache,
    RemoteAssetProgressResult,
    RemoteAssetScanCancelled,
    RemoteAssetProgressService,
    create_cancellable_svn_runner,
)
from .selective_update import SelectiveUpdatePlanner
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
APP_ICON_PATH = RESOURCE_DIR / "migration_guard.ico"
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
UI_FONT_CANDIDATES = (
    "Microsoft YaHei UI",
    "Microsoft YaHei",
    "Segoe UI",
)
STATE_COLORS = {
    VerificationState.COMPLETE: "#15803D",
    VerificationState.SUBMITTED: "#047857",
    VerificationState.PENDING_COMMIT: "#B45309",
    VerificationState.NOT_MIGRATED: "#B42318",
    VerificationState.NEEDS_UPDATE: "#2563EB",
    VerificationState.NEEDS_REVIEW: "#6D5BD0",
    VerificationState.BLOCKED: "#B42318",
}
ISSUE_KEY_PATTERN = re.compile(
    r"\b(?:SER|OSC|SERIA|OSCOA)-\d+\b",
    re.IGNORECASE,
)


def _preferred_ui_font_family(root: Tk) -> str:
    available = {
        family.casefold(): family
        for family in tkfont.families(root)
    }
    for candidate in UI_FONT_CANDIDATES:
        family = available.get(candidate.casefold())
        if family is not None:
            return family
    return str(
        tkfont.nametofont("TkDefaultFont", root=root).actual("family")
    )


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
        initial_width = min(1360, max(920, root.winfo_screenwidth() - 40))
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
        self._build_typography()

        config = load_config()
        self.domestic_root = StringVar(value=config.domestic_root)
        self.overseas_trunk_root = StringVar(
            value=config.overseas_trunk_root
        )
        self.overseas_ob_root = StringVar(value=config.overseas_ob_root)
        self.source_workspace = StringVar()
        self.target_workspace = StringVar()
        self.route_summary = StringVar()
        self.source_root = StringVar()
        self.target_root = StringVar()
        self.source_issue = StringVar()
        self.target_issue = StringVar()
        self.lookback_days = IntVar(value=config.lookback_days)
        self.remote_refresh_minutes = IntVar(
            value=config.remote_refresh_minutes
        )
        self.include_externals = BooleanVar(value=config.include_externals)
        self.trunk_sheet_url = StringVar(value=config.trunk_sheet_url)
        self.osob_sheet_url = StringVar(value=config.osob_sheet_url)
        self.module_enabled = {
            name: BooleanVar(value=name in config.enabled_modules)
            for name in ("res", "doc", "bin")
        }
        self.filter_state = StringVar(value="全部")
        self.detail_filter_text = StringVar(value="更多 ▼")
        self.result_view = StringVar(value="单号")
        self.status_text = StringVar(value="就绪")
        self.last_refresh_text = StringVar(value="尚未刷新")
        self.workflow_stage_text = StringVar(value="未开始")
        self.workflow_progress = IntVar(value=0)
        self.summary_text = {
            "all": StringVar(value="0"),
            "pending_all": StringVar(value="0"),
            VerificationState.NOT_MIGRATED.value: StringVar(value="0"),
            VerificationState.PENDING_COMMIT.value: StringVar(value="0"),
            VerificationState.COMPLETE.value: StringVar(value="0"),
            VerificationState.SUBMITTED.value: StringVar(value="0"),
            VerificationState.NEEDS_UPDATE.value: StringVar(value="0"),
            VerificationState.NEEDS_REVIEW.value: StringVar(value="0"),
            VerificationState.BLOCKED.value: StringVar(value="0"),
        }
        self.summary_button_text = {
            "all": StringVar(value="全部 0"),
            "pending_all": StringVar(value="待处理 0"),
            VerificationState.COMPLETE.value: StringVar(
                value="已完成 0"
            ),
            VerificationState.BLOCKED.value: StringVar(value="阻断 0"),
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
        self.audit_tree_files: dict[str, FileVerification] = {}
        self.audit_tree_file_groups: dict[
            str,
            tuple[FileVerification, ...],
        ] = {}
        self.audit_tree_groups: dict[
            str,
            tuple[FileVerification, ...],
        ] = {}
        self.audit_tree_cases: dict[str, MigrationAuditResult] = {}
        self.visible_ticket_mappings: list[TicketMapping] = []
        self.visible_ticket_progress: list[TicketJiraProgress] = []
        self.remote_asset_result: RemoteAssetProgressResult | None = None
        self.remote_asset_tree: AssetProgressTree | None = None
        self.remote_notices: list[tuple[str, str, str]] = []
        self.remote_tree_assets: dict[str, RemoteAssetProgress] = {}
        self.remote_tree_groups: dict[
            str,
            tuple[RemoteAssetProgress, ...],
        ] = {}
        self.remote_tree_mappings: dict[str, TicketMapping] = {}
        self.ticket_snapshot: TicketSheetSnapshot | None = None
        self.ticket_snapshots: dict[str, TicketSheetSnapshot] = {}
        self.jira_client = JiraIssueClient()
        self._jira_request_id = 0
        self._remote_asset_cache = RemoteAssetProgressCache()
        self._remote_asset_cancel_event: threading.Event | None = None
        self._remote_refresh_after_id: str | None = None
        self.active_table_kind = TABLE_TRUNK
        self.table_mode = "audit"
        self.settings_window: Toplevel | None = None
        self._workspace_syncing = False
        self._ticket_parse_after_id: str | None = None
        self._set_workspace_route(config.source_workspace, save=False)

        self._build_styles()
        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.bind("<F5>", self._refresh_shortcut)
        self.root.bind(
            "<Configure>",
            self._update_summary_layout,
            add="+",
        )
        self.root.after_idle(self._update_summary_layout)
        self.root.after(UI_POLL_MS, self._poll_events)

    def _build_typography(self) -> None:
        self.ui_font_family = _preferred_ui_font_family(self.root)
        for name in (
            "TkDefaultFont",
            "TkTextFont",
            "TkMenuFont",
            "TkCaptionFont",
            "TkSmallCaptionFont",
            "TkIconFont",
            "TkTooltipFont",
        ):
            try:
                tkfont.nametofont(name, root=self.root).configure(
                    family=self.ui_font_family,
                    size=9,
                    weight="normal",
                )
            except Exception:
                continue
        try:
            tkfont.nametofont(
                "TkHeadingFont",
                root=self.root,
            ).configure(
                family=self.ui_font_family,
                size=10,
                weight="bold",
            )
        except Exception:
            pass
        self.type_fonts = {
            "title": tkfont.Font(
                root=self.root,
                family=self.ui_font_family,
                size=18,
                weight="bold",
            ),
            "dialog_title": tkfont.Font(
                root=self.root,
                family=self.ui_font_family,
                size=12,
                weight="bold",
            ),
            "section_title": tkfont.Font(
                root=self.root,
                family=self.ui_font_family,
                size=11,
                weight="bold",
            ),
            "body": tkfont.Font(
                root=self.root,
                family=self.ui_font_family,
                size=10,
            ),
            "body_bold": tkfont.Font(
                root=self.root,
                family=self.ui_font_family,
                size=10,
                weight="bold",
            ),
            "label": tkfont.Font(
                root=self.root,
                family=self.ui_font_family,
                size=9,
                weight="bold",
            ),
            "metadata": tkfont.Font(
                root=self.root,
                family=self.ui_font_family,
                size=9,
            ),
        }

    def _build_styles(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure("App.TFrame", background="#E7EAED")
        style.configure("Panel.TFrame", background="#F2F2F0")
        style.configure("Signal.TFrame", background="#FFFA00")
        style.configure(
            "Title.TLabel",
            background="#E7EAED",
            foreground="#191919",
            font=self.type_fonts["title"],
        )
        style.configure(
            "DialogTitle.TLabel",
            background="#E7EAED",
            foreground="#191919",
            font=self.type_fonts["dialog_title"],
        )
        style.configure(
            "SectionTitle.TLabel",
            background="#E7EAED",
            foreground="#191919",
            font=self.type_fonts["section_title"],
        )
        style.configure(
            "SectionHint.TLabel",
            background="#E7EAED",
            foreground="#686A65",
            font=self.type_fonts["metadata"],
        )
        style.configure(
            "Field.TLabel",
            background="#E7EAED",
            foreground="#475467",
            font=self.type_fonts["label"],
        )
        style.configure(
            "Muted.TLabel",
            background="#E7EAED",
            foreground="#686A65",
            font=self.type_fonts["body"],
        )
        style.configure(
            "Panel.TLabel",
            background="#F2F2F0",
            foreground="#191919",
            font=self.type_fonts["body"],
        )
        style.configure(
            "SummaryStatus.TLabel",
            background="#F2F2F0",
            foreground="#686A65",
            font=self.type_fonts["body"],
            padding=(4, 0),
        )
        style.configure(
            "Summary.TRadiobutton",
            background="#F2F2F0",
            foreground="#343C45",
            font=self.type_fonts["body_bold"],
            padding=(8, 6),
        )
        style.map(
            "Summary.TRadiobutton",
            background=[
                ("disabled", "#E9E9E5"),
                ("active", "#FFFDD1"),
            ],
            foreground=[("disabled", "#475467")],
        )
        style.configure(
            "ResultTab.Toolbutton",
            background="#E9E9E5",
            foreground="#475467",
            font=self.type_fonts["body_bold"],
            padding=(12, 5),
            borderwidth=1,
        )
        style.map(
            "ResultTab.Toolbutton",
            background=[
                ("disabled", "#E9E9E5"),
                ("pressed", "#191919"),
                ("selected", "#232B34"),
                ("active", "#FFFDD1"),
            ],
            foreground=[
                ("disabled", "#475467"),
                ("pressed", "#FFFFFF"),
                ("selected", "#FFFFFF"),
            ],
        )
        style.configure(
            "Primary.TButton",
            background="#FFFA00",
            foreground="#191919",
            font=self.type_fonts["body_bold"],
            padding=(12, 7),
            borderwidth=0,
        )
        style.map(
            "Primary.TButton",
            background=[
                ("disabled", "#E4E7EC"),
                ("pressed", "#C9C500"),
                ("active", "#DED900"),
            ],
            foreground=[("disabled", "#475467")],
        )
        style.configure(
            "Tool.TButton",
            background="#F2F2F0",
            foreground="#343C45",
            font=self.type_fonts["body"],
            padding=(9, 6),
        )
        style.map(
            "Tool.TButton",
            background=[
                ("disabled", "#E4E7EC"),
                ("pressed", "#191919"),
                ("active", "#26313A"),
            ],
            foreground=[
                ("disabled", "#475467"),
                ("pressed", "#FFFFFF"),
                ("active", "#FFFFFF"),
            ],
        )
        style.configure(
            "Source.TButton",
            background="#F2F2F0",
            foreground="#475467",
            font=self.type_fonts["body"],
            padding=(9, 6),
        )
        style.map(
            "Source.TButton",
            background=[
                ("disabled", "#E4E7EC"),
                ("pressed", "#191919"),
                ("active", "#26313A"),
            ],
            foreground=[
                ("disabled", "#475467"),
                ("pressed", "#FFFFFF"),
                ("active", "#FFFFFF"),
            ],
        )
        style.configure(
            "SourceSelected.TButton",
            background="#FFFDD1",
            foreground="#191919",
            font=self.type_fonts["body_bold"],
            padding=(9, 6),
        )
        style.map(
            "SourceSelected.TButton",
            background=[
                ("disabled", "#E4E7EC"),
                ("pressed", "#DED900"),
                ("active", "#FFF7A0"),
            ],
            foreground=[("disabled", "#475467")],
        )
        style.configure(
            "Workspace.TButton",
            background="#FFFFFF",
            foreground="#191919",
            font=self.type_fonts["body_bold"],
            padding=(10, 7),
        )
        style.map(
            "Workspace.TButton",
            background=[
                ("disabled", "#E4E7EC"),
                ("pressed", "#191919"),
                ("active", "#26313A"),
            ],
            foreground=[
                ("disabled", "#475467"),
                ("pressed", "#FFFFFF"),
                ("active", "#FFFFFF"),
            ],
        )
        style.configure(
            "WorkspaceMenu.TButton",
            background="#E9E9E5",
            foreground="#343C45",
            font=self.type_fonts["label"],
            padding=(4, 7),
        )
        style.map(
            "WorkspaceMenu.TButton",
            background=[
                ("disabled", "#E4E7EC"),
                ("pressed", "#191919"),
                ("active", "#26313A"),
            ],
            foreground=[
                ("disabled", "#475467"),
                ("pressed", "#FFFFFF"),
                ("active", "#FFFFFF"),
            ],
        )
        style.configure(
            "Treeview",
            background="#FFFFFF",
            fieldbackground="#FFFFFF",
            foreground="#191919",
            rowheight=max(
                28,
                self.type_fonts["body"].metrics("linespace") + 6,
            ),
            font=self.type_fonts["body"],
        )
        style.map(
            "Treeview",
            background=[("selected", "#26313A")],
            foreground=[("selected", "#FFFFFF")],
        )
        style.configure(
            "Treeview.Heading",
            background="#E9E9E5",
            foreground="#343C45",
            font=self.type_fonts["body_bold"],
            padding=(6, 6),
        )
        style.configure(
            "Workflow.Horizontal.TProgressbar",
            troughcolor="#DCE0E4",
            background="#18D1FF",
        )
        style.configure(
            "WorkflowSuccess.Horizontal.TProgressbar",
            troughcolor="#DCEFE7",
            background="#00B978",
        )
        style.configure(
            "WorkflowWarning.Horizontal.TProgressbar",
            troughcolor="#FFF5DF",
            background="#A76816",
        )
        style.configure(
            "WorkflowError.Horizontal.TProgressbar",
            troughcolor="#FFECE7",
            background="#C84B3A",
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
        brand_signal = ttk.Frame(
            header,
            style="Signal.TFrame",
            width=5,
            height=28,
        )
        brand_signal.pack(side=LEFT, padx=(0, 8))
        brand_signal.pack_propagate(False)
        ttk.Label(
            header,
            text=APP_TITLE,
            style="Title.TLabel",
        ).pack(side=LEFT)
        self.trunk_table_button = ttk.Button(
            header,
            text="合海外 Trunk",
            style="Source.TButton",
            command=lambda: self._start_ticket_table(TABLE_TRUNK),
        )
        self.trunk_table_button.pack(side=LEFT, padx=(14, 4))
        self.osob_table_button = ttk.Button(
            header,
            text="合海外 Trunk-OB",
            style="Source.TButton",
            command=lambda: self._start_ticket_table(TABLE_OSOB),
        )
        self.osob_table_button.pack(side=LEFT)
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

        paths = ttk.Frame(container, style="Panel.TFrame", padding=(10, 8))
        paths.pack(fill=X, pady=(10, 6))
        ttk.Label(
            paths,
            text="路线",
            style="Panel.TLabel",
        ).grid(row=0, column=0, sticky="w")
        self.route_button = ttk.Button(
            paths,
            textvariable=self.route_summary,
            style="Workspace.TButton",
            command=self._show_route_selector,
        )
        self.route_button.grid(
            row=0,
            column=1,
            sticky="w",
            padx=(6, 0),
        )
        self.route_menu_button = ttk.Button(
            paths,
            text="▼",
            width=2,
            style="WorkspaceMenu.TButton",
            command=self._show_route_selector,
        )
        self.route_menu_button.grid(
            row=0,
            column=2,
            sticky="w",
            padx=(1, 0),
        )
        route_menu = Menu(paths, tearoff=False)
        route_menu.add_command(
            label="国内 trunk → 海外 trunk",
            command=lambda: self._set_workspace_route(WORKSPACE_DOMESTIC),
        )
        route_menu.add_command(
            label="海外 trunk → 海外 OB",
            command=lambda: self._set_workspace_route(
                WORKSPACE_OVERSEAS_TRUNK
            ),
        )
        self.route_menu = route_menu
        actions = ttk.Frame(paths, style="Panel.TFrame")
        actions.grid(row=0, column=3, sticky="e")
        self.migrate_button = ttk.Button(
            actions,
            text="迁移",
            style="Primary.TButton",
            command=self._start_batch_migration,
            state="disabled",
        )
        self.migrate_button.pack(side=RIGHT, padx=(0, 6))
        self._attach_tooltip(
            self.migrate_button,
            "存在待处理资产时执行迁移；全部完成后重新复核",
        )
        self.update_button = ttk.Button(
            actions,
            text="更新并复核",
            style="Tool.TButton",
            command=self._start_update_and_audit,
        )
        self.update_button.pack(side=RIGHT, padx=(0, 6))
        paths.columnconfigure(3, weight=1)
        self._attach_tooltip(
            self.update_button,
            "有工作区时更新并复核；无工作区时刷新远端状态",
        )
        self._attach_tooltip(
            self.route_button,
            "切换迁移路线",
        )
        self._attach_tooltip(
            self.route_menu_button,
            "切换迁移路线",
        )

        task_row = ttk.Frame(container, style="Panel.TFrame", padding=(10, 8))
        task_row.pack(fill=X, pady=(0, 6))
        command_row = ttk.Frame(task_row, style="Panel.TFrame")
        command_row.pack(fill=X)
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
            font=self.type_fonts["body"],
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
            style="Primary.TButton",
            command=self._start_ticket_resolution,
        )
        self.resolve_button.pack(side=LEFT, anchor="n")

        summary = ttk.Frame(container, style="Panel.TFrame", padding=(6, 3))
        summary.pack(fill=X, pady=(0, 6))
        self.summary_bar = summary
        self.result_view_buttons = []
        for index, label in enumerate(("单号", "资产")):
            button = ttk.Radiobutton(
                summary,
                text=label,
                value=label,
                variable=self.result_view,
                command=self._on_result_view_changed,
                style="ResultTab.Toolbutton",
                width=6,
            )
            button.pack(
                side=LEFT,
                padx=(0, 10 if index == 1 else 2),
            )
            self.result_view_buttons.append(button)
        summary_items = (
            ("全部", "all"),
            ("待处理", "pending_all"),
            ("已完成", VerificationState.COMPLETE.value),
            ("阻断", VerificationState.BLOCKED.value),
        )
        for label, key in summary_items:
            button = ttk.Radiobutton(
                summary,
                textvariable=self.summary_button_text[key],
                value=label,
                variable=self.filter_state,
                command=lambda: self._set_summary_filter(
                    self.filter_state.get()
                ),
                style="Summary.TRadiobutton",
                width=8,
            )
            button.pack(side=LEFT, padx=(0, 2))
        self.detail_filter_button = ttk.Menubutton(
            summary,
            textvariable=self.detail_filter_text,
            style="Tool.TButton",
            width=6,
        )
        self.detail_filter_button.pack(side=LEFT, padx=(4, 0))
        detail_filter_menu = Menu(
            self.detail_filter_button,
            tearoff=False,
        )
        for label in (
            "未迁移",
            "待提交",
            "已提交",
            "需更新",
            "需确认",
        ):
            detail_filter_menu.add_command(
                label=label,
                command=lambda value=label: self._set_summary_filter(
                    value,
                    detailed=True,
                ),
            )
        self.detail_filter_button.configure(menu=detail_filter_menu)
        progress_group = ttk.Frame(summary, style="Panel.TFrame")
        self.progress_group = progress_group
        progress_group.pack(side=RIGHT)
        self.workflow_progress_bar = ttk.Progressbar(
            progress_group,
            variable=self.workflow_progress,
            maximum=100,
            mode="determinate",
            length=110,
            takefocus=True,
            style="Workflow.Horizontal.TProgressbar",
        )
        self.workflow_progress_bar.pack(side=LEFT, padx=(8, 4))
        self.progress_status_label = ttk.Label(
            progress_group,
            textvariable=self.last_refresh_text,
            style="SummaryStatus.TLabel",
            width=18,
            anchor="e",
        )
        self.progress_status_label.pack(side=LEFT)
        self._attach_tooltip(
            self.progress_status_label,
            self.status_text,
        )
        self._attach_tooltip(
            self.workflow_progress_bar,
            self.status_text,
        )

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
            "target": "提交",
        }
        widths = {
            "state": 70,
            "module": 52,
            "path": 250,
            "source": 84,
            "local": 78,
            "target": 88,
        }
        for name in columns:
            self.table.heading(name, text=headings[name])
            self.table.column(
                name,
                width=widths[name],
                minwidth=widths[name],
                stretch=name == "path",
                anchor="e" if name == "path" else "center",
            )
        for state, color in STATE_COLORS.items():
            self.table.tag_configure(state.value, foreground=color)
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
        self.table.tag_configure("jira-osob", foreground="#15803D")
        self.table.tag_configure("jira-trunk", foreground="#047857")
        self.table.tag_configure("jira-domestic", foreground="#B45309")
        self.table.tag_configure("jira-unknown", foreground="#667085")
        self.table.tag_configure("jira-warning", foreground="#B42318")
        self.table.tag_configure(
            "remote-folder",
            font=self.type_fonts["body_bold"],
        )
        self.table.tag_configure(
            "audit-folder",
            font=self.type_fonts["body_bold"],
        )
        self.table.bind("<<TreeviewSelect>>", self._show_selected_detail)
        self.table.bind("<Double-1>", self._on_table_double_click)
        self._attach_tree_tooltip(self.table)

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
        self._set_result_view_enabled(False)

        detail_header = ttk.Frame(detail_panel, style="Panel.TFrame")
        detail_header.pack(fill=X)
        ttk.Label(
            detail_header,
            text="核验详情",
            style="Panel.TLabel",
        ).pack(side=LEFT)
        self.open_path_button = ttk.Button(
            detail_header,
            text="定位文件",
            style="Tool.TButton",
            command=self._open_selected_path,
            state="disabled",
        )
        self.open_path_button.pack(side=RIGHT)
        self._attach_tooltip(
            self.open_path_button,
            "在资源管理器中选中该资产的目标工作副本文件",
        )
        self.use_ticket_button = ttk.Button(
            detail_header,
            text="使用选中",
            style="Tool.TButton",
            command=self._use_selected_ticket,
            state="disabled",
        )
        self.detail = Text(
            detail_panel,
            wrap="word",
            relief="flat",
            borderwidth=0,
            background="#FFFFFF",
            foreground="#344054",
            font=self.type_fonts["body"],
            padx=2,
            pady=8,
        )
        self.detail.pack(fill=BOTH, expand=True)
        for state, color in STATE_COLORS.items():
            self.detail.tag_configure(
                f"issue-{state.value}",
                foreground=color,
                font=self.type_fonts["body_bold"],
            )
        self.detail.configure(state="disabled")

        self._update_contextual_action_states()

    def _set_initial_sash(self) -> None:
        width = self.body.winfo_width()
        if width > 1:
            self.body.sashpos(0, int(width * 0.7))

    def _mark_refresh_time(self, action: str = "刷新") -> None:
        self.last_refresh_text.set(
            f"上次{action} {datetime.now():%H:%M}"
        )

    def _update_summary_layout(self, _event: object = None) -> None:
        try:
            scaling = float(self.root.tk.call("tk", "scaling"))
        except (TypeError, ValueError):
            scaling = 1.0
        compact = (
            self.root.winfo_width() < 960
            or (
                self.root.winfo_width() < 1100
                and scaling >= 1.75
            )
        )
        visible = bool(self.progress_status_label.winfo_manager())
        if compact and visible:
            self.progress_status_label.pack_forget()
        elif not compact and not visible:
            self.progress_status_label.pack(
                side=LEFT,
                before=self.workflow_progress_bar,
            )

    def _set_use_ticket_button_visible(self, visible: bool) -> None:
        if visible:
            if not self.use_ticket_button.winfo_manager():
                self.use_ticket_button.pack(
                    side=RIGHT,
                    padx=(0, 6),
                    before=self.open_path_button,
                )
            return
        self.use_ticket_button.pack_forget()

    def _set_result_view_enabled(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        for button in self.result_view_buttons:
            button.configure(state=state)

    def _on_result_view_changed(self) -> None:
        if self.table_mode not in {"audit", "remote-assets"}:
            return
        self.filter_state.set("全部")
        self.detail_filter_text.set("更多 ▼")
        self._refresh_table()

    def _set_summary_filter(
        self,
        label: str,
        *,
        detailed: bool = False,
    ) -> None:
        self.filter_state.set(label)
        self.detail_filter_text.set(
            f"{label} ▼" if detailed else "更多 ▼"
        )
        self._refresh_table()

    def _set_summary_counts(
        self,
        total: int,
        counts: dict[object, int],
    ) -> None:
        def value(state: VerificationState) -> int:
            return int(
                counts.get(
                    state,
                    counts.get(state.value, 0),
                )
            )

        self.summary_text["all"].set(str(total))
        for state in VerificationState:
            self.summary_text[state.value].set(str(value(state)))
        self.summary_text[VerificationState.COMPLETE.value].set(
            str(
                value(VerificationState.COMPLETE)
                + value(VerificationState.SUBMITTED)
            )
        )
        pending = sum(
            value(state)
            for state in (
                VerificationState.NOT_MIGRATED,
                VerificationState.PENDING_COMMIT,
                VerificationState.NEEDS_UPDATE,
                VerificationState.NEEDS_REVIEW,
            )
        )
        self.summary_text["pending_all"].set(str(pending))
        for label, key in (
            ("全部", "all"),
            ("待处理", "pending_all"),
            ("已完成", VerificationState.COMPLETE.value),
            ("阻断", VerificationState.BLOCKED.value),
        ):
            self.summary_button_text[key].set(
                f"{label} {self.summary_text[key].get()}"
            )

    @staticmethod
    def _show_workspace_menu(
        menu: Menu,
        anchor: ttk.Widget,
    ) -> None:
        try:
            menu.tk_popup(
                anchor.winfo_rootx(),
                anchor.winfo_rooty() + anchor.winfo_height(),
            )
        finally:
            menu.grab_release()

    def _show_route_selector(self) -> None:
        self._show_workspace_menu(
            self.route_menu,
            self.route_button,
        )

    def _local_workspaces_available(self) -> bool:
        enabled = self._effective_module_names()
        if not enabled:
            return False
        source = Path(self.source_root.get().strip())
        target = Path(self.target_root.get().strip())
        return all(
            (source / name).is_dir() and (target / name).is_dir()
            for name in enabled
        )

    def _configured_module_names(self) -> tuple[str, ...]:
        return tuple(
            name
            for name, variable in self.module_enabled.items()
            if variable.get()
        )

    def _automatic_scan_scope(self) -> bool:
        return (
            not self._configured_module_names()
            and not self.include_externals.get()
        )

    def _remote_module_names(self) -> tuple[str, ...]:
        return self._configured_module_names() or ("res", "doc", "bin")

    def _effective_module_names(self) -> tuple[str, ...]:
        configured = self._configured_module_names()
        if configured:
            return configured
        result = self.remote_asset_result
        if result is None or result.warnings:
            return ("res", "doc", "bin")
        inferred = tuple(
            name
            for name in ("res", "doc", "bin")
            if any(asset.module == name for asset in result.assets)
        )
        return inferred or ("res", "doc", "bin")

    def _effective_include_externals(self) -> bool:
        return (
            self.include_externals.get()
            or self._automatic_scan_scope()
        )

    def _attach_tooltip(
        self,
        widget: ttk.Widget,
        text: str | StringVar,
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
                text=(
                    text.get()
                    if isinstance(text, StringVar)
                    else text
                ),
                style="Panel.TLabel",
                padding=(7, 4),
                wraplength=520,
                justify="left",
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
        widget.bind("<FocusIn>", show, add="+")
        widget.bind("<FocusOut>", hide, add="+")

    def _attach_tree_tooltip(self, table: ttk.Treeview) -> None:
        tooltip: Toplevel | None = None
        active_key: tuple[str, str] | None = None

        def hide(_event: object = None) -> None:
            nonlocal tooltip, active_key
            if tooltip is not None:
                tooltip.destroy()
                tooltip = None
            active_key = None

        def show(event: object) -> None:
            nonlocal tooltip, active_key
            x = int(getattr(event, "x", 0))
            y = int(getattr(event, "y", 0))
            item_id = table.identify_row(y)
            column = table.identify_column(x)
            if not item_id or column != "#0":
                hide()
                return
            text = str(table.item(item_id, "text"))
            bounds = table.bbox(item_id, column)
            if not text or not bounds:
                hide()
                return
            depth = 0
            parent_id = table.parent(item_id)
            while parent_id:
                depth += 1
                parent_id = table.parent(parent_id)
            available = max(0, int(bounds[2]) - 34 - depth * 18)
            if self.type_fonts["body"].measure(text) <= available:
                hide()
                return
            key = (item_id, text)
            if active_key != key:
                hide()
                tooltip = Toplevel(self.root)
                tooltip.overrideredirect(True)
                tooltip.attributes("-topmost", True)
                ttk.Label(
                    tooltip,
                    text=text,
                    style="Panel.TLabel",
                    padding=(8, 5),
                    wraplength=680,
                    justify="left",
                ).pack()
                active_key = key
            if tooltip is not None:
                tooltip.geometry(
                    f"+{int(getattr(event, 'x_root', 0)) + 14}"
                    f"+{int(getattr(event, 'y_root', 0)) + 18}"
                )

        table.bind("<Motion>", show, add="+")
        table.bind("<Leave>", hide, add="+")
        table.bind("<ButtonPress>", hide, add="+")
        table.bind("<MouseWheel>", hide, add="+")

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
            self.route_summary.set(
                f"{WORKSPACE_LABELS[source_role]} → "
                f"{WORKSPACE_LABELS[target_role]}"
            )
            self.source_root.set(self._workspace_path(source_role))
            self.target_root.set(self._workspace_path(target_role))
        finally:
            self._workspace_syncing = False
        if save:
            self._save_config()

    def _selected_modules_for_roots(
        self,
        source_root: str,
        target_root: str,
    ) -> tuple[WorkspaceModule, ...]:
        enabled = self._effective_module_names()
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
            remote_refresh_minutes=self.remote_refresh_minutes.get(),
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
        table_label = (
            "合海外 Trunk-OB"
            if table_kind == TABLE_OSOB
            else "合海外 Trunk"
        )
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
        *,
        start_preview: bool = False,
    ) -> None:
        if table_kind is not None:
            self.active_table_kind = table_kind
        self.ticket_snapshots[self.active_table_kind] = snapshot
        self._set_table_button_snapshot(
            self.active_table_kind,
            snapshot,
        )
        self._render_ticket_snapshot(snapshot)
        if start_preview and self.visible_ticket_mappings:
            mappings = tuple(self.visible_ticket_mappings)
            self._use_ticket_mappings(
                snapshot,
                mappings,
                start_audit=False,
            )
            self._start_jira_progress(mappings)

    def _set_table_button_snapshot(
        self,
        table_kind: str,
        snapshot: TicketSheetSnapshot,
    ) -> None:
        if table_kind == TABLE_OSOB:
            button = self.osob_table_button
            label = "合海外 Trunk-OB"
        else:
            button = self.trunk_table_button
            label = "合海外 Trunk"
        marker = _sheet_tab_marker(snapshot.sheet_name)
        button.configure(text=f"{label} · {marker}")
        self.trunk_table_button.configure(
            style=(
                "SourceSelected.TButton"
                if table_kind == TABLE_TRUNK
                else "Source.TButton"
            )
        )
        self.osob_table_button.configure(
            style=(
                "SourceSelected.TButton"
                if table_kind == TABLE_OSOB
                else "Source.TButton"
            )
        )

    def _render_ticket_snapshot(
        self,
        snapshot: TicketSheetSnapshot,
    ) -> None:
        self._set_use_ticket_button_visible(True)
        self._set_result_view_enabled(False)
        self.table_mode = "tickets"
        self.table.configure(show="headings", displaycolumns="#all")
        self.ticket_snapshot = snapshot
        self.current_result = None
        self.current_ticket_mapping = None
        self.current_ticket_mappings = ()
        self.source_issue.set("")
        self.target_issue.set("")
        self.migrate_button.configure(state="disabled")
        self.visible_files = []
        self.visible_ticket_progress = []
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
            "state": 112,
            "module": 42,
            "path": 220,
            "source": 90,
            "local": 90,
            "target": 52,
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
            style="Primary.TButton",
        )
        self.open_path_button.configure(state="disabled")
        self._set_summary_counts(len(self.visible_ticket_mappings), {})
        self.filter_state.set("全部")
        self.detail_filter_text.set("更多 ▼")
        self.status_text.set(
            f"{snapshot.sheet_name}："
            f"{len(self.visible_ticket_mappings)} 条，选择后开始核验"
        )
        self._update_contextual_action_states()
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
        window.geometry("940x470")
        window.minsize(820, 440)
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
        module_values = {
            name: BooleanVar(value=variable.get())
            for name, variable in self.module_enabled.items()
        }
        external_value = BooleanVar(value=self.include_externals.get())
        lookback_value = IntVar(value=self.lookback_days.get())
        refresh_value = IntVar(value=self.remote_refresh_minutes.get())
        container = ttk.Frame(
            window,
            style="App.TFrame",
            padding=(14, 8),
        )
        container.pack(fill=BOTH, expand=True)

        def choose_path(variable: StringVar) -> None:
            selected = filedialog.askdirectory(
                title="选择工作区根目录",
                initialdir=variable.get() or None,
                parent=window,
            )
            if selected:
                variable.set(selected)

        heading = ttk.Frame(container, style="App.TFrame")
        heading.grid(row=0, column=0, sticky="ew", pady=(0, 4))
        settings_signal = ttk.Frame(
            heading,
            style="Signal.TFrame",
            width=5,
            height=26,
        )
        settings_signal.pack(side=LEFT, padx=(0, 8))
        settings_signal.pack_propagate(False)
        title_group = ttk.Frame(heading, style="App.TFrame")
        title_group.pack(side=LEFT, fill=X)
        ttk.Label(
            title_group,
            text="迁移设置",
            style="DialogTitle.TLabel",
        ).pack(side=LEFT)
        ttk.Label(
            title_group,
            text="工作区、固定表与核验策略",
            style="SectionHint.TLabel",
        ).pack(side=LEFT, padx=(10, 0), pady=(5, 0))
        ttk.Separator(container).grid(
            row=1,
            column=0,
            sticky="ew",
        )

        workspace_section = ttk.Frame(
            container,
            style="App.TFrame",
        )
        workspace_section.grid(
            row=2,
            column=0,
            sticky="ew",
            pady=(6, 8),
        )
        ttk.Label(
            workspace_section,
            text="工作区",
            style="SectionTitle.TLabel",
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(
            workspace_section,
            text="三段迁移路线使用的本地根目录",
            style="SectionHint.TLabel",
        ).grid(
            row=0,
            column=1,
            columnspan=2,
            sticky="w",
            padx=(8, 0),
        )
        workspace_entries: dict[str, ttk.Entry] = {}
        for column, (label, key) in enumerate(
            (
                ("国内 trunk", "domestic"),
                ("海外 trunk", "overseas"),
                ("海外 OB", "osob"),
            )
        ):
            field = ttk.Frame(
                workspace_section,
                style="App.TFrame",
            )
            field.grid(
                row=1,
                column=column,
                sticky="ew",
                padx=(0 if column == 0 else 8, 0),
                pady=(5, 0),
            )
            ttk.Label(
                field,
                text=label,
                style="Field.TLabel",
            ).pack(anchor="w", pady=(0, 2))
            input_row = ttk.Frame(field, style="App.TFrame")
            input_row.pack(fill=X)
            entry = ttk.Entry(
                input_row,
                textvariable=values[key],
                width=16,
            )
            entry.pack(side=LEFT, fill=X, expand=True)
            workspace_entries[key] = entry
            choose_button = ttk.Button(
                input_row,
                text="...",
                width=3,
                style="Tool.TButton",
                command=lambda variable=values[key]: choose_path(variable),
            )
            choose_button.pack(side=LEFT, padx=(4, 0))
            self._attach_tooltip(choose_button, f"选择{label}目录")
            workspace_section.columnconfigure(column, weight=1)

        ttk.Separator(container).grid(
            row=3,
            column=0,
            sticky="ew",
        )
        sheet_section = ttk.Frame(container, style="App.TFrame")
        sheet_section.grid(
            row=4,
            column=0,
            sticky="ew",
            pady=(6, 8),
        )
        ttk.Label(
            sheet_section,
            text="固定表",
            style="SectionTitle.TLabel",
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(
            sheet_section,
            text="每次读取排序最前的可见页签",
            style="SectionHint.TLabel",
        ).grid(
            row=0,
            column=1,
            sticky="w",
            padx=(8, 0),
        )
        sheet_entries: dict[str, ttk.Entry] = {}
        for column, (label, key) in enumerate(
            (
                ("合海外 Trunk", "trunk_sheet"),
                ("合海外 Trunk-OB", "osob_sheet"),
            )
        ):
            field = ttk.Frame(sheet_section, style="App.TFrame")
            field.grid(
                row=1,
                column=column,
                sticky="ew",
                padx=(0 if column == 0 else 10, 0),
                pady=(5, 0),
            )
            ttk.Label(
                field,
                text=label,
                style="Field.TLabel",
            ).pack(anchor="w", pady=(0, 2))
            entry = ttk.Entry(
                field,
                textvariable=values[key],
            )
            entry.pack(fill=X)
            sheet_entries[key] = entry
            sheet_section.columnconfigure(column, weight=1)

        ttk.Separator(container).grid(
            row=5,
            column=0,
            sticky="ew",
        )
        strategy_section = ttk.Frame(container, style="App.TFrame")
        strategy_section.grid(
            row=6,
            column=0,
            sticky="ew",
            pady=(6, 0),
        )
        ttk.Label(
            strategy_section,
            text="核验策略",
            style="SectionTitle.TLabel",
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(
            strategy_section,
            text="范围全部未选时按单据自动推导",
            style="SectionHint.TLabel",
        ).grid(
            row=0,
            column=1,
            columnspan=2,
            sticky="w",
            padx=(8, 0),
        )

        scope = ttk.Frame(strategy_section, style="App.TFrame")
        scope.grid(row=1, column=0, sticky="w", pady=(5, 0))
        ttk.Label(
            scope,
            text="扫描范围",
            style="Field.TLabel",
        ).pack(anchor="w", pady=(0, 2))
        checks = ttk.Frame(scope, style="App.TFrame")
        checks.pack(anchor="w")
        for name in ("res", "doc", "bin"):
            ttk.Checkbutton(
                checks,
                text=name,
                variable=module_values[name],
            ).pack(side=LEFT, padx=(0, 10))
        ttk.Checkbutton(
            checks,
            text="externals",
            variable=external_value,
        ).pack(side=LEFT)

        lookback = ttk.Frame(strategy_section, style="App.TFrame")
        lookback.grid(
            row=1,
            column=1,
            sticky="w",
            padx=(24, 0),
            pady=(5, 0),
        )
        ttk.Label(
            lookback,
            text="最大回溯",
            style="Field.TLabel",
        ).pack(anchor="w", pady=(0, 2))
        lookback_control = ttk.Frame(lookback, style="App.TFrame")
        lookback_control.pack(anchor="w")
        ttk.Spinbox(
            lookback_control,
            from_=1,
            to=3650,
            width=7,
            textvariable=lookback_value,
        ).pack(side=LEFT)
        ttk.Label(
            lookback_control,
            text="天",
            style="Field.TLabel",
        ).pack(side=LEFT, padx=(6, 0))

        refresh = ttk.Frame(strategy_section, style="App.TFrame")
        refresh.grid(
            row=1,
            column=2,
            sticky="w",
            padx=(24, 0),
            pady=(5, 0),
        )
        ttk.Label(
            refresh,
            text="自动刷新",
            style="Field.TLabel",
        ).pack(anchor="w", pady=(0, 2))
        refresh_choices = ttk.Frame(refresh, style="App.TFrame")
        refresh_choices.pack(anchor="w")
        for minutes in (2, 5):
            ttk.Radiobutton(
                refresh_choices,
                text=f"{minutes} 分钟",
                value=minutes,
                variable=refresh_value,
            ).pack(side=LEFT, padx=(0, 12))

        strategy_section.columnconfigure(0, weight=2)
        strategy_section.columnconfigure(1, weight=1)
        strategy_section.columnconfigure(2, weight=1)
        container.columnconfigure(0, weight=1)
        container.rowconfigure(7, weight=1)
        footer = ttk.Frame(container, style="App.TFrame")
        footer.grid(
            row=8,
            column=0,
            sticky="ew",
            pady=(8, 0),
        )

        def close_window() -> None:
            self.settings_window = None
            window.destroy()

        def save_settings() -> None:
            root_keys = ("domestic", "overseas", "osob")
            roots = tuple(
                values[key].get().strip()
                for key in root_keys
            )
            if not all(roots):
                messagebox.showwarning(
                    "配置不完整",
                    "三个工作区目录都必须填写。",
                    parent=window,
                )
                missing_key = next(
                    key
                    for key in root_keys
                    if not values[key].get().strip()
                )
                workspace_entries[missing_key].focus_set()
                return
            try:
                lookback_days = int(lookback_value.get())
            except (TypeError, ValueError):
                lookback_days = 0
            if not 1 <= lookback_days <= 3650:
                messagebox.showwarning(
                    "回溯天数无效",
                    "最大回溯天数必须在 1 到 3650 之间。",
                    parent=window,
                )
                return
            sheet_keys = ("trunk_sheet", "osob_sheet")
            sheet_urls = tuple(
                values[key].get().strip()
                for key in sheet_keys
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
                invalid_key = next(
                    key
                    for key in sheet_keys
                    if not values[key].get().strip()
                    or not any(
                        marker in values[key].get()
                        for marker in (
                            "/wiki/",
                            "/sheets/",
                            "/spreadsheets/",
                        )
                    )
                )
                sheet_entries[invalid_key].focus_set()
                return
            self.domestic_root.set(roots[0])
            self.overseas_trunk_root.set(roots[1])
            self.overseas_ob_root.set(roots[2])
            self.trunk_sheet_url.set(sheet_urls[0])
            self.osob_sheet_url.set(sheet_urls[1])
            for name, variable in self.module_enabled.items():
                variable.set(module_values[name].get())
            self.include_externals.set(external_value.get())
            self.lookback_days.set(lookback_days)
            self.remote_refresh_minutes.set(refresh_value.get())
            source_role = self._workspace_role(
                self.source_workspace.get()
            )
            self._set_workspace_route(source_role, save=False)
            self.ticket_snapshots.clear()
            self.trunk_table_button.configure(
                text="合海外 Trunk",
                style="Source.TButton",
            )
            self.osob_table_button.configure(
                text="合海外 Trunk-OB",
                style="Source.TButton",
            )
            self.current_ticket_mapping = None
            self.current_ticket_mappings = ()
            self._cancel_remote_asset_query()
            self._save_config()
            self.status_text.set("迁移设置已保存")
            self._update_contextual_action_states()
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
        window.bind("<Escape>", lambda _event: close_window())
        window.bind("<Return>", lambda _event: save_settings())
        window.protocol("WM_DELETE_WINDOW", close_window)
        window.grab_set()
        window.after_idle(workspace_entries["domestic"].focus_set)

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
        self._set_table_button_snapshot(
            self.active_table_kind,
            snapshot,
        )
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
            self._update_contextual_action_states()
            return
        self.ticket_snapshots[self.active_table_kind] = snapshot
        self.ticket_snapshot = snapshot
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
        self._start_jira_progress(mappings)

    def _start_jira_progress(
        self,
        mappings: tuple[TicketMapping, ...],
        *,
        force_refresh: bool = False,
    ) -> None:
        self._cancel_remote_asset_query()
        self._jira_request_id += 1
        request_id = self._jira_request_id
        cancel_event = threading.Event()
        self._remote_asset_cancel_event = cancel_event
        enabled_modules = self._remote_module_names()
        self.remote_asset_result = None
        try:
            lookback_days = int(self.lookback_days.get())
        except (TypeError, ValueError):
            lookback_days = 90
        self.status_text.set(
            "正在刷新 Jira 与远端 SVN 状态..."
            if force_refresh
            else f"已解析 {len(mappings)} 条，正在读取 Jira 进度..."
        )
        threading.Thread(
            target=self._jira_progress_worker,
            args=(
                request_id,
                mappings,
                enabled_modules,
                lookback_days,
                cancel_event,
                force_refresh,
            ),
            name="migration-jira-progress",
            daemon=True,
        ).start()

    def _jira_progress_worker(
        self,
        request_id: int,
        mappings: tuple[TicketMapping, ...],
        enabled_modules: tuple[str, ...],
        lookback_days: int,
        cancel_event: threading.Event,
        force_refresh: bool,
    ) -> None:
        issues = {}
        try:
            issue_keys = tuple(
                dict.fromkeys(
                    issue
                    for mapping in mappings
                    for issue in (
                        mapping.source_issue,
                        mapping.target_issue or mapping.source_issue,
                    )
                )
            )
            issues = self.jira_client.fetch_many(
                issue_keys,
                force_refresh=force_refresh,
            )
            if cancel_event.is_set():
                return
            progress = build_ticket_progress(mappings, issues)
            self.events.put(
                ("jira-progress", (request_id, progress))
            )
        except Exception as exc:
            if cancel_event.is_set():
                return
            self.events.put(
                ("jira-progress-error", (request_id, str(exc)))
            )
        try:
            query_start = _jira_query_start(
                tuple(issues.values()),
                lookback_days,
            )
            service = RemoteAssetProgressService(
                svn=SvnClient(
                    runner=create_cancellable_svn_runner(cancel_event),
                    log=self._queue_log,
                ),
                progress=lambda stage, message: self.events.put(
                    (
                        "remote-assets-progress",
                        (request_id, stage, message),
                    )
                ),
                cache=self._remote_asset_cache,
                cancel_event=cancel_event,
            )
            result = service.scan(
                mappings,
                enabled_modules=enabled_modules,
                lookback_days=lookback_days,
                start_date=query_start,
                force_refresh=force_refresh,
            )
            if cancel_event.is_set():
                return
            self.events.put(
                ("remote-assets", (request_id, result))
            )
        except RemoteAssetScanCancelled:
            return
        except Exception as exc:
            if cancel_event.is_set():
                return
            self.events.put(
                ("remote-assets-error", (request_id, str(exc)))
            )

    def _cancel_remote_asset_query(self) -> None:
        if self._remote_refresh_after_id is not None:
            try:
                self.root.after_cancel(self._remote_refresh_after_id)
            except Exception:
                pass
            self._remote_refresh_after_id = None
        if self._remote_asset_cancel_event is not None:
            self._remote_asset_cancel_event.set()
            self._remote_asset_cancel_event = None

    def _schedule_remote_auto_refresh(self) -> None:
        if self._remote_refresh_after_id is not None:
            try:
                self.root.after_cancel(self._remote_refresh_after_id)
            except Exception:
                pass
            self._remote_refresh_after_id = None
        if (
            not self.current_ticket_mappings
            or self._local_workspaces_available()
        ):
            return
        delay = max(1, self.remote_refresh_minutes.get()) * 60_000
        self._remote_refresh_after_id = self.root.after(
            delay,
            self._auto_refresh_remote_progress,
        )

    def _auto_refresh_remote_progress(self) -> None:
        self._remote_refresh_after_id = None
        if self.busy:
            self._schedule_remote_auto_refresh()
            return
        mappings = self.current_ticket_mappings
        if not mappings or self._local_workspaces_available():
            return
        self.status_text.set("自动刷新 Jira 与远端 SVN 状态...")
        self._start_jira_progress(mappings, force_refresh=True)

    def _render_jira_progress(
        self,
        progress: tuple[TicketJiraProgress, ...],
    ) -> None:
        self._set_use_ticket_button_visible(True)
        self._set_result_view_enabled(False)
        self.table_mode = "jira"
        self.table.configure(show="headings", displaycolumns="#all")
        self.current_result = None
        self.visible_files = []
        self.remote_notices = []
        self.visible_ticket_mappings = []
        self.visible_ticket_progress = list(progress)
        self.table.delete(*self.table.get_children())
        headings = {
            "state": "当前阶段",
            "module": "一致性",
            "path": "任务",
            "source": "国内 Jira",
            "local": "海外 Jira",
            "target": "版本登记",
        }
        widths = {
            "state": 74,
            "module": 58,
            "path": 185,
            "source": 110,
            "local": 110,
            "target": 115,
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
        self.open_path_button.configure(state="disabled")
        counts = {state: 0 for state in VerificationState}
        require_osob = self.active_table_kind == TABLE_OSOB
        for item in progress:
            counts[
                _jira_summary_state(
                    item,
                    require_osob=require_osob,
                )
            ] += 1
        self._set_summary_counts(len(progress), counts)
        self.filter_state.set("全部")
        self.detail_filter_text.set("更多 ▼")
        self._refresh_jira_table()
        failed = sum(
            1
            for item in progress
            if not item.source.available or not item.target.available
        )
        self.status_text.set(
            f"Jira 进度已更新：{len(progress)} 条"
            + (f"，{failed} 条读取失败" if failed else "")
        )
        self._mark_refresh_time()

    def _refresh_jira_table(self) -> None:
        self.table.delete(*self.table.get_children())
        selected_filter = self.filter_state.get()
        for index, item in enumerate(self.visible_ticket_progress):
            summary_state = _jira_summary_state(
                item,
                require_osob=self.active_table_kind == TABLE_OSOB,
            )
            if not _filter_matches(selected_filter, summary_state):
                continue
            title = (
                item.mapping.target_text
                or item.mapping.source_text
                or (
                    f"{item.mapping.source_issue} → "
                    f"{item.mapping.target_issue}"
                )
            )
            self.table.insert(
                "",
                END,
                iid=str(index),
                values=(
                    item.stage_label,
                    item.consistency_label,
                    title,
                    (
                        f"{item.mapping.source_issue} "
                        f"{item.source.status or '-'}"
                    ),
                    (
                        f"{item.mapping.target_issue or item.mapping.source_issue} "
                        f"{item.target.status or '-'}"
                    ),
                    item.branch_label,
                ),
                tags=(_jira_progress_tag(item),),
            )
        children = self.table.get_children()
        if children:
            self.table.selection_set(children)
            self.table.focus(children[0])
            self.table.see(children[0])
        self.use_ticket_button.configure(
            text=f"核验选中（{len(children)}）",
            state="normal" if children else "disabled",
            style="Tool.TButton",
        )
        self._show_selected_detail()

    def _render_remote_assets(
        self,
        result: RemoteAssetProgressResult,
    ) -> None:
        self._set_use_ticket_button_visible(False)
        self._set_result_view_enabled(True)
        self.table_mode = "remote-assets"
        self.current_result = None
        self.remote_asset_result = result
        self.remote_notices = list(
            _remote_asset_notices(
                self.current_ticket_mappings,
                result,
            )
        )
        self.visible_files = []
        self.visible_ticket_mappings = []
        self.filter_state.set("全部")
        self.detail_filter_text.set("更多 ▼")
        self.open_path_button.configure(state="disabled")
        self._refresh_remote_result()
        count_text = result.counts
        source_note = "缓存" if result.from_cache else (
            f"{result.elapsed_seconds:.1f}s"
        )
        refresh_note = (
            f" · {self.remote_refresh_minutes.get()} 分钟自动刷新"
            if not self._local_workspaces_available()
            else ""
        )
        review_note = (
            f" · {len(self.remote_notices)} 单无源 SVN 变更"
            if self.remote_notices
            else ""
        )
        self.status_text.set(
            f"资产 {len(result.assets)} · {source_note} · "
            f"起点 {result.query_start or '-'}：国内 "
            f"{count_text['domestic']}，海外 trunk "
            f"{count_text['overseas_trunk']}，OB "
            f"{count_text['osob']}{review_note}{refresh_note}"
        )
        self._mark_refresh_time()

    def _configure_remote_result_table(self) -> None:
        self.table.configure(
            show="tree headings",
            displaycolumns=("state", "module", "path", "source"),
        )
        self.table.heading(
            "#0",
            text=(
                "单号 / 资产"
                if self.result_view.get() == "单号"
                else "资产位置"
            ),
        )
        self.table.column(
            "#0",
            width=280,
            minwidth=200,
            stretch=True,
            anchor="w",
        )
        for name, title, sample in (
            ("state", "国内 trunk", "国内 trunk"),
            ("module", "海外 trunk", "海外 trunk"),
            ("path", "海外 OB", "海外 OB"),
            ("source", "状态", "海外 trunk"),
        ):
            width = max(
                96,
                self.type_fonts["body_bold"].measure(sample) + 22,
            )
            self.table.heading(name, text=title)
            self.table.column(
                name,
                width=width,
                minwidth=width,
                stretch=False,
                anchor="center",
            )

    def _refresh_remote_result(self) -> None:
        if self.remote_asset_result is None:
            return
        self._configure_remote_result_table()
        self.remote_tree_assets = {}
        self.remote_tree_groups = {}
        self.remote_tree_mappings = {}
        if self.result_view.get() == "单号":
            self._refresh_remote_ticket_tree()
        else:
            self._refresh_remote_asset_tree()

    def _refresh_remote_ticket_tree(self) -> None:
        result = self.remote_asset_result
        if result is None:
            return
        require_osob = self.active_table_kind == TABLE_OSOB
        mapping_rows = tuple(
            (
                mapping,
                _remote_assets_for_mapping(mapping, result),
            )
            for mapping in self.current_ticket_mappings
        )
        states = tuple(
            _remote_mapping_state(
                mapping,
                assets,
                require_osob=require_osob,
            )
            for mapping, assets in mapping_rows
        )
        self._set_summary_counts(
            len(mapping_rows),
            _count_states(states),
        )
        selected_filter = self.filter_state.get()
        self.table.delete(*self.table.get_children())
        for index, ((mapping, assets), state) in enumerate(
            zip(mapping_rows, states)
        ):
            if not _filter_matches(selected_filter, state):
                continue
            node_id = f"remote-ticket-{index}"
            self.remote_tree_mappings[node_id] = mapping
            total = len(assets)
            self.table.insert(
                "",
                END,
                iid=node_id,
                text=_ticket_tree_label(
                    mapping.source_issue,
                    mapping.target_issue,
                    total,
                    description=_mapping_description(mapping),
                ),
                values=(
                    _remote_stage_count(assets, "domestic"),
                    _remote_stage_count(assets, "overseas_trunk"),
                    _remote_stage_count(assets, "osob"),
                    state.label,
                ),
                open=state != VerificationState.COMPLETE,
                tags=("remote-folder", state.value),
            )
            if assets:
                tree = AssetProgressTree(assets)
                self._insert_remote_progress_tree(
                    tree,
                    parent_id=node_id,
                    prefix=f"remote-ticket-{index}",
                    initial_depth=0,
                )
        self._select_first_result_row()

    def _refresh_remote_asset_tree(self) -> None:
        result = self.remote_asset_result
        if result is None:
            return
        require_osob = self.active_table_kind == TABLE_OSOB
        states = tuple(
            _remote_asset_summary_state(
                asset,
                require_osob=require_osob,
            )
            for asset in result.assets
        )
        self._set_summary_counts(
            len(result.assets),
            _count_states(states),
        )
        selected_filter = self.filter_state.get()
        assets = tuple(
            asset
            for asset in result.assets
            if _filter_matches(
                selected_filter,
                _remote_asset_summary_state(
                    asset,
                    require_osob=require_osob,
                ),
            )
        )
        tree = AssetProgressTree(assets)
        self.remote_asset_tree = tree
        self.table.delete(*self.table.get_children())
        self._insert_remote_progress_tree(
            tree,
            parent_id="",
            prefix="remote-asset",
            initial_depth=0,
        )
        self._select_first_result_row(
            empty_message="当前筛选下没有资产。",
        )

    def _insert_remote_progress_tree(
        self,
        tree: AssetProgressTree,
        *,
        parent_id: str,
        prefix: str,
        initial_depth: int,
    ) -> None:
        def insert_node(
            current_parent_id: str,
            source_node_id: str,
            depth: int,
        ) -> None:
            node = tree.nodes[source_node_id]
            node_id = f"{prefix}-{source_node_id}"
            label = node.name
            if not node.is_asset:
                descendants = tree.descendant_assets(source_node_id)
                label += f" ({len(descendants)})"
                self.remote_tree_groups[node_id] = descendants
                state = _aggregate_states(
                    tuple(
                        _remote_asset_summary_state(
                            asset,
                            require_osob=(
                                self.active_table_kind == TABLE_OSOB
                            ),
                        )
                        for asset in descendants
                    )
                )
            else:
                asset = tree.asset_for_node(source_node_id)
                if asset is not None:
                    self.remote_tree_assets[node_id] = asset
                    state = _remote_asset_summary_state(
                        asset,
                        require_osob=(
                            self.active_table_kind == TABLE_OSOB
                        ),
                    )
                else:
                    state = VerificationState.NEEDS_REVIEW
            stage = tree.stage(source_node_id)
            tags = (
                ("remote-folder", state.value)
                if not node.is_asset
                else (state.value,)
            )
            self.table.insert(
                current_parent_id,
                END,
                iid=node_id,
                text=label,
                values=(
                    tree.stage_label(source_node_id, "domestic"),
                    tree.stage_label(source_node_id, "overseas_trunk"),
                    tree.stage_label(source_node_id, "osob"),
                    _remote_stage_label(stage),
                ),
                open=depth < 2,
                tags=tags,
            )
            for child_id in node.children:
                insert_node(node_id, child_id, depth + 1)

        for root_id in tree.root_ids:
            insert_node(parent_id, root_id, initial_depth)

    def _select_first_result_row(
        self,
        *,
        empty_message: str = "当前筛选下没有单号。",
    ) -> None:
        roots = self.table.get_children()
        if roots:
            self.table.selection_set(roots[0])
            self.table.focus(roots[0])
            self.table.see(roots[0])
        else:
            self._set_detail(empty_message)
        self._show_selected_detail()

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
        self._update_contextual_action_states()
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
        self._update_contextual_action_states()
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
            if not self._local_workspaces_available():
                self._start_jira_progress(
                    self.current_ticket_mappings,
                    force_refresh=True,
                )
                return
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
        self._cancel_remote_asset_query()
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
            include_externals = self._effective_include_externals()
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
        self._reset_workflow_progress(label)
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
            service = MigrationAuditService(
                svn=SvnClient(log=self._queue_log),
                progress=lambda stage, message: self.events.put(
                    ("progress", (stage, message))
                ),
                include_externals=include_externals,
            )
            cases = tuple(
                MigrationCase(
                    item.source_issue,
                    item.target_issue,
                    item.target_text or item.source_text,
                )
                for item in mappings
            )
            if update_first:
                self.events.put(
                    (
                        "progress",
                        (
                            "selective-discovery",
                            "先扫描本批次文件，规划精细更新范围",
                        ),
                    )
                )
                initial_result = service.audit_batch(
                    modules,
                    cases,
                    lookback_days=lookback_days,
                )
                planner = SelectiveUpdatePlanner(service.svn)
                self.events.put(
                    (
                        "progress",
                        (
                            "selective-status",
                            "检查源文件是否落后于仓库",
                        ),
                    )
                )
                update_plan = planner.build(initial_result, modules)
                self.events.put(("update-plan", update_plan))
                if not update_plan.empty:
                    update_result = MigrationUpdateClient(
                        log=self._queue_log,
                    ).update_folders(update_plan.targets)
                    self.events.put(("update-result", update_result))
                    if not update_result.get("ok"):
                        raise RuntimeError(
                            str(
                                update_result.get(
                                    "message",
                                    "精细更新未全部成功",
                                )
                            )
                        )
                    self.events.put(
                        (
                            "progress",
                            (
                                "selective-verify",
                                "精细更新完成，重新核验全部文件",
                            ),
                        )
                    )
                    result = service.audit_batch(
                        modules,
                        cases,
                        lookback_days=lookback_days,
                    )
                else:
                    result = initial_result
            else:
                result = service.audit_batch(
                    modules,
                    cases,
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
        self._cancel_remote_asset_query()
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
            include_externals = self._effective_include_externals()
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
        self._reset_workflow_progress("批量迁移")
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
            font=self.type_fonts["body_bold"],
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
        self._cancel_remote_asset_query()
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
            include_externals = self._effective_include_externals()
            self._save_config()
        except (ValueError, OSError) as exc:
            messagebox.showwarning("无法开始", str(exc))
            return

        self.busy = True
        self.task_failed = False
        self.active_task = "audit"
        self.current_result = None
        self._set_action_buttons("disabled")
        self._reset_workflow_progress(label)
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

    def _refresh_shortcut(self, _event: object = None) -> str:
        if str(self.update_button.cget("state")) != "disabled":
            self._start_update_and_audit()
        return "break"

    def _set_action_buttons(self, state: str) -> None:
        self.update_button.configure(state=state)
        self.migrate_button.configure(state=state)
        self.route_button.configure(state=state)
        self.route_menu_button.configure(state=state)
        self.resolve_button.configure(state=state)
        self.trunk_table_button.configure(state=state)
        self.osob_table_button.configure(state=state)
        self.sheet_config_button.configure(state=state)
        if self.use_ticket_button.winfo_manager():
            self.use_ticket_button.configure(state=state)
        if state == "normal":
            self._update_contextual_action_states()

    def _update_contextual_action_states(self) -> None:
        if self.busy:
            return
        has_mapping = self._current_mapping_selection_is_valid()
        has_workspace = (
            has_mapping and self._local_workspaces_available()
        )
        can_migrate = (
            isinstance(
                self.current_result,
                BatchMigrationAuditResult,
            )
            and bool(self.current_ticket_mappings)
        )
        self.update_button.configure(
            text=(
                "更新并复核"
                if has_workspace
                else "刷新状态"
            ),
            state="normal" if has_mapping else "disabled",
            style=(
                "Primary.TButton"
                if (
                    has_mapping
                    and not can_migrate
                    and self.table_mode != "tickets"
                )
                else "Tool.TButton"
            ),
        )
        self.resolve_button.configure(
            state="normal",
            style=(
                "Tool.TButton"
                if has_mapping or self.table_mode == "tickets"
                else "Primary.TButton"
            ),
        )
        if can_migrate and self.current_result is not None:
            if self.current_result.complete:
                self.migrate_button.configure(
                    text="复核",
                    command=self._start_audit,
                    state="normal",
                )
            else:
                self.migrate_button.configure(
                    text="迁移",
                    command=self._start_batch_migration,
                    state="normal",
                )
        else:
            self.migrate_button.configure(
                text="迁移",
                command=self._start_batch_migration,
                state="disabled",
            )
        if self.use_ticket_button.winfo_manager():
            selectable = bool(self.table.get_children())
            self.use_ticket_button.configure(
                state="normal" if selectable else "disabled",
                style=(
                    "Primary.TButton"
                    if self.table_mode == "tickets"
                    else "Tool.TButton"
                ),
            )

    def _update_migrate_button_state(self) -> None:
        self._update_contextual_action_states()

    def _configure_audit_table(self, *, tree: bool = True) -> None:
        self._set_use_ticket_button_visible(False)
        self._set_result_view_enabled(tree)
        self.table.configure(
            show="tree headings" if tree else "headings",
            displaycolumns=(
                ("state", "source", "local", "target")
                if tree
                else "#all"
            ),
        )
        self.table.heading(
            "#0",
            text=(
                (
                    "单号 / 资产"
                    if self.result_view.get() == "单号"
                    else "资产位置"
                )
                if tree
                else ""
            ),
        )
        self.table.column(
            "#0",
            width=300 if tree else 0,
            minwidth=200 if tree else 0,
            stretch=tree,
            anchor="w",
        )
        headings = {
            "state": "状态",
            "module": "模块",
            "path": "相对路径",
            "source": "源版本",
            "local": "目标本地",
            "target": "提交",
        }
        widths = {
            "state": 70,
            "module": 52,
            "path": 250,
            "source": 84,
            "local": 78,
            "target": 88,
        }
        for name in self.table["columns"]:
            self.table.heading(name, text=headings[name])
            self.table.column(
                name,
                width=widths[name],
                minwidth=widths[name],
                stretch=name == "path",
                anchor="e" if name == "path" else "center",
            )
        self.table_mode = "audit"
        self.use_ticket_button.configure(state="disabled")
        self.open_path_button.configure(state="disabled")

    def _show_progress_row(
        self,
        message: str,
        *,
        state: str = "进行中",
        stage: str = "",
    ) -> None:
        self._configure_audit_table(tree=False)
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

    def _reset_workflow_progress(self, label: str) -> None:
        self.workflow_progress.set(0)
        self.workflow_stage_text.set(label)
        self.workflow_progress_bar.configure(
            style="Workflow.Horizontal.TProgressbar"
        )

    def _update_workflow_progress(
        self,
        stage: str,
        message: str,
    ) -> None:
        progress_by_stage = {
            "selective-discovery": 5,
            "workspace": 10,
            "source-log": 20,
            "target-log": 32,
            "target-status": 40,
            "selective-status": 48,
            "selective-update": 58,
            "selective-verify": 64,
            "preflight": 12,
            "migrate": 44,
            "checkout-scan": 60,
            "checkout": 76,
            "verify": 90,
            "osob-preflight": 8,
        }
        value = progress_by_stage.get(stage)
        if value is not None:
            self.workflow_progress.set(value)
        self.workflow_stage_text.set(message[:42])

    def _finish_workflow_progress(
        self,
        *,
        complete: bool,
        failed: bool = False,
    ) -> None:
        self.workflow_progress.set(100)
        if failed:
            style = "WorkflowError.Horizontal.TProgressbar"
            label = "执行失败"
        elif complete:
            style = "WorkflowSuccess.Horizontal.TProgressbar"
            label = "全部完成"
        else:
            style = "WorkflowWarning.Horizontal.TProgressbar"
            label = "仍有待处理项"
        self.workflow_progress_bar.configure(style=style)
        self.workflow_stage_text.set(label)

    def _poll_events(self) -> None:
        try:
            while True:
                event, payload = self.events.get_nowait()
                if event == "progress":
                    stage, message = payload
                    self.status_text.set(str(message))
                    self._update_workflow_progress(
                        str(stage),
                        str(message),
                    )
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
                    self._update_workflow_progress(
                        "selective-update",
                        f"{owner}精细更新完成",
                    )
                    self._show_progress_row(f"{owner}更新完成")
                elif event == "update-plan":
                    plan = payload
                    message = (
                        f"精细更新 {len(plan.targets)} 个目录"
                        f"（源落后 {plan.stale_source_count}，"
                        f"目标落后 {plan.stale_target_count}）"
                    )
                    if plan.empty:
                        message = (
                            f"已检查 {plan.source_path_count} 个源文件，"
                            "均为最新"
                        )
                    self.status_text.set(message)
                    self._update_workflow_progress(
                        "selective-status",
                        message,
                    )
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
                    self._show_ticket_table(
                        snapshot,
                        table_kind,
                        start_preview=True,
                    )
                elif event == "jira-progress":
                    request_id, progress = payload
                    if (
                        request_id == self._jira_request_id
                        and self.active_task not in {"audit", "migration"}
                    ):
                        self._render_jira_progress(progress)
                elif event == "jira-progress-error":
                    request_id, message = payload
                    if request_id == self._jira_request_id:
                        self.status_text.set(
                            f"Jira 进度读取失败：{message}"
                        )
                elif event == "remote-assets-progress":
                    request_id, _stage, message = payload
                    if request_id == self._jira_request_id:
                        self.status_text.set(str(message))
                elif event == "remote-assets":
                    request_id, result = payload
                    if (
                        request_id == self._jira_request_id
                        and self.active_task not in {"audit", "migration"}
                    ):
                        self._render_remote_assets(result)
                        self._schedule_remote_auto_refresh()
                elif event == "remote-assets-error":
                    request_id, message = payload
                    if request_id == self._jira_request_id:
                        self.status_text.set(
                            f"远端资产记录读取失败：{message}"
                        )
                        self._schedule_remote_auto_refresh()
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
                    self._finish_workflow_progress(complete=False)
                elif event == "error":
                    self.task_failed = True
                    self.status_text.set("执行失败")
                    if self.active_task in {"audit", "migration"}:
                        self._show_progress_row(
                            str(payload),
                            state="失败",
                        )
                    self._set_detail(str(payload))
                    self._finish_workflow_progress(
                        complete=False,
                        failed=True,
                    )
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
                        pending = _audit_pending_summary(
                            self.current_result
                        )
                        self.status_text.set(
                            "核验完成"
                            if self.current_result.complete
                            else f"核验完成：{pending}"
                        )
                        self._finish_workflow_progress(
                            complete=self.current_result.complete
                        )
                        if not self.current_result.complete:
                            self.workflow_stage_text.set(pending)
                    elif (
                        finished_task == "migration"
                        and payload == "migration"
                        and not self.task_failed
                        and self.current_result is not None
                    ):
                        pending = _audit_pending_summary(
                            self.current_result
                        )
                        self.status_text.set(
                            "批量迁移与复核完成"
                            if self.current_result.complete
                            else f"迁移完成：{pending}"
                        )
                        self._finish_workflow_progress(
                            complete=self.current_result.complete
                        )
                        if not self.current_result.complete:
                            self.workflow_stage_text.set(pending)
        except queue.Empty:
            pass
        self.root.after(UI_POLL_MS, self._poll_events)

    def _render_result(
        self,
        result: MigrationAuditResult | BatchMigrationAuditResult,
    ) -> None:
        self._configure_audit_table(tree=True)
        self.ticket_snapshot = None
        self.visible_ticket_mappings = []
        self.visible_ticket_progress = []
        self.filter_state.set("全部")
        self.detail_filter_text.set("更多 ▼")
        self._update_migrate_button_state()
        self._refresh_table()
        self._mark_refresh_time("复核")
        if result.warnings and not self.table.get_children():
            self._set_detail("\n".join(result.warnings))
        elif not result.files:
            self._set_detail(
                "没有找到可核验资产；单号页签中仍会显示需确认任务。"
            )

    def _refresh_table(self) -> None:
        if self.table_mode == "tickets":
            return
        if self.table_mode == "jira":
            self._refresh_jira_table()
            return
        if self.table_mode == "remote-assets":
            self._refresh_remote_result()
            return
        self._configure_audit_table(tree=True)
        self.table.delete(*self.table.get_children())
        self.visible_files = []
        self.audit_tree_files = {}
        self.audit_tree_file_groups = {}
        self.audit_tree_groups = {}
        self.audit_tree_cases = {}
        if self.current_result is None:
            return
        if self.result_view.get() == "单号":
            self._refresh_audit_ticket_tree()
        else:
            self._refresh_audit_asset_tree()

    def _refresh_audit_ticket_tree(self) -> None:
        result = self.current_result
        if result is None:
            return
        cases = _audit_cases(result)
        states = tuple(_audit_case_state(case) for case in cases)
        self._set_summary_counts(len(cases), _count_states(states))
        selected_filter = self.filter_state.get()
        for index, (case, state) in enumerate(zip(cases, states)):
            if not _filter_matches(selected_filter, state):
                continue
            node_id = f"audit-ticket-{index}"
            self.audit_tree_cases[node_id] = case
            file_groups = self._audit_file_groups(case.files)
            total = len(file_groups)
            complete = sum(
                _state_is_complete(
                    _audit_group_state(group)
                )
                for group in file_groups
            )
            target_revisions = len(
                {
                    revision
                    for item in case.files
                    for revision in item.target_revisions
                }
            )
            self.table.insert(
                "",
                END,
                iid=node_id,
                text=_ticket_tree_label(
                    case.source_issue,
                    case.target_issue,
                    total,
                    description=_audit_case_description(
                        case,
                        self.current_ticket_mappings,
                    ),
                ),
                values=(
                    state.label,
                    "任务",
                    "",
                    f"{total} 项" if total else "-",
                    (
                        f"{complete}/{total} 完成"
                        if total
                        else "无源 SVN 变更"
                    ),
                    (
                        f"{target_revisions} 个版本"
                        if target_revisions
                        else "-"
                    ),
                ),
                open=state != VerificationState.COMPLETE,
                tags=("audit-folder", state.value),
            )
            if file_groups:
                self._insert_audit_file_groups(
                    file_groups,
                    parent_id=node_id,
                    prefix=f"audit-ticket-{index}",
                    initial_depth=0,
                )
        self._select_first_result_row(
            empty_message="当前筛选下没有单号。",
        )

    def _refresh_audit_asset_tree(self) -> None:
        result = self.current_result
        if result is None:
            return
        file_groups = self._audit_file_groups(result.files)
        states = tuple(
            _audit_group_state(group)
            for group in file_groups
        )
        self._set_summary_counts(
            len(file_groups),
            _count_states(states),
        )
        selected_filter = self.filter_state.get()
        filtered_groups = tuple(
            group
            for group, state in zip(file_groups, states)
            if _filter_matches(selected_filter, state)
        )
        self._insert_audit_file_groups(
            filtered_groups,
            parent_id="",
            prefix="audit-asset",
            initial_depth=0,
        )
        self._select_first_result_row(
            empty_message=(
                "当前筛选下没有资产；无资产任务请在单号页签查看。"
            ),
        )

    def _audit_file_groups(
        self,
        files: tuple[FileVerification, ...],
    ) -> tuple[tuple[FileVerification, ...], ...]:
        groups: dict[str, list[FileVerification]] = {}
        for item in files:
            display_path = _audit_display_path(
                item,
                self.source_root.get(),
                self.target_root.get(),
            )
            key = (
                f"{item.expected.module}/"
                f"{display_path.replace(chr(92), '/').strip('/')}"
            ).casefold()
            groups.setdefault(key, []).append(item)
        return tuple(tuple(group) for group in groups.values())

    def _insert_audit_file_groups(
        self,
        file_groups: tuple[tuple[FileVerification, ...], ...],
        *,
        parent_id: str,
        prefix: str,
        initial_depth: int,
    ) -> None:
        directory_ids: dict[str, str] = {}
        directory_files: dict[str, list[FileVerification]] = {}
        directory_depth: dict[str, int] = {}
        root_parent_id = parent_id
        for file_group in file_groups:
            item = file_group[0]
            state = _audit_group_state(file_group)
            relative_path = _audit_display_path(
                item,
                self.source_root.get(),
                self.target_root.get(),
            )
            parts = [
                part
                for part in relative_path.replace("\\", "/").split("/")
                if part
            ]
            if not parts:
                parts = [item.expected.module, "未知资产"]
            if parts[0].casefold() != item.expected.module.casefold():
                parts.insert(0, item.expected.module)
            current_parent_id = root_parent_id
            path_parts: list[str] = []
            for depth, part in enumerate(parts[:-1]):
                path_parts.append(part)
                key = "/".join(path_parts).casefold()
                node_id = directory_ids.get(key)
                if node_id is None:
                    node_id = (
                        f"{prefix}-dir-{len(directory_ids)}"
                    )
                    directory_ids[key] = node_id
                    directory_files[node_id] = []
                    directory_depth[node_id] = initial_depth + depth
                    self.table.insert(
                        current_parent_id,
                        END,
                        iid=node_id,
                        text=part,
                        values=("", "", "", "", "", ""),
                        open=initial_depth + depth < 2,
                        tags=("audit-folder",),
                    )
                directory_files[node_id].extend(file_group)
                current_parent_id = node_id
            source_revisions = ",".join(
                f"r{revision}"
                for revision in sorted(
                    {
                        revision
                        for grouped_item in file_group
                        for revision in (
                            grouped_item.expected.source_revisions
                        )
                    }
                )
            )
            target_revisions = ",".join(
                f"r{revision}"
                for revision in sorted(
                    {
                        revision
                        for grouped_item in file_group
                        for revision in grouped_item.target_revisions
                    }
                )
            ) or "-"
            local_statuses = tuple(
                dict.fromkeys(
                    grouped_item.local_status
                    for grouped_item in file_group
                )
            )
            index = len(self.visible_files)
            self.visible_files.append(item)
            item_id = f"{prefix}-file-{index}"
            self.audit_tree_files[item_id] = item
            self.audit_tree_file_groups[item_id] = file_group
            self.table.insert(
                current_parent_id,
                END,
                iid=item_id,
                text=parts[-1],
                values=(
                    state.label,
                    item.expected.module,
                    relative_path,
                    source_revisions,
                    (
                        local_statuses[0]
                        if len(local_statuses) == 1
                        else "混合"
                    ),
                    target_revisions,
                ),
                tags=(state.value,),
            )
        for node_id, files in directory_files.items():
            grouped_files = self._audit_file_groups(tuple(files))
            states = tuple(
                _audit_group_state(group)
                for group in grouped_files
            )
            state = _aggregate_states(states)
            complete = sum(_state_is_complete(value) for value in states)
            self.audit_tree_groups[node_id] = tuple(files)
            self.table.item(
                node_id,
                values=(
                    state.label,
                    "",
                    "",
                    f"{len(grouped_files)} 项",
                    f"{complete}/{len(grouped_files)} 完成",
                    "",
                ),
                open=directory_depth[node_id] < 2,
                tags=("audit-folder", state.value),
            )

    def _selected_item(self) -> FileVerification | None:
        if self.table_mode != "audit":
            return None
        selection = self.table.selection()
        if not selection:
            return None
        return self.audit_tree_files.get(selection[0])

    def _selected_tickets(self) -> tuple[TicketMapping, ...]:
        if self.table_mode == "remote-assets":
            return self.current_ticket_mappings
        if self.table_mode not in {"tickets", "jira"}:
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
                index = int(item_id)
                if self.table_mode == "jira":
                    result.append(
                        self.visible_ticket_progress[index].mapping
                    )
                else:
                    result.append(self.visible_ticket_mappings[index])
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
        if self.table_mode in {"tickets", "jira"}:
            self._use_selected_ticket()
            return
        self._copy_selected_path(event)

    def _show_selected_detail(self, _event: object = None) -> None:
        self.open_path_button.configure(state="disabled")
        if self.table_mode == "remote-assets":
            selection = self.table.selection()
            if not selection:
                return
            selected_id = selection[0]
            mapping = self.remote_tree_mappings.get(selected_id)
            if mapping is not None:
                result = self.remote_asset_result
                if result is None:
                    return
                assets = _remote_assets_for_mapping(mapping, result)
                state = _remote_mapping_state(
                    mapping,
                    assets,
                    require_osob=self.active_table_kind == TABLE_OSOB,
                )
                complete = sum(
                    _state_is_complete(
                        _remote_asset_summary_state(
                            asset,
                            require_osob=(
                                self.active_table_kind == TABLE_OSOB
                            ),
                        )
                    )
                    for asset in assets
                )
                lines = [
                    f"单号状态：{state.label}",
                    f"路线：{mapping.route.label}",
                    "",
                    f"源单号：{mapping.source_issue}",
                    f"目标单号：{mapping.target_issue or '-'}",
                    "任务描述："
                    f"{_mapping_description(mapping) or '-'}",
                    f"关联资产：{len(assets)}",
                    f"已完成资产：{complete}",
                    "",
                    "国内 trunk："
                    f"{_remote_stage_count(assets, 'domestic')}",
                    "海外 trunk："
                    f"{_remote_stage_count(assets, 'overseas_trunk')}",
                    f"海外 OB：{_remote_stage_count(assets, 'osob')}",
                ]
                if not assets:
                    lines.extend(
                        (
                            "",
                            "未找到源阶段 SVN 变更；这不表示迁移失败，"
                            "请确认该任务是否没有资产改动或使用了其他单号。",
                        )
                    )
                self._set_detail("\n".join(lines), issue_state=state)
                return
            descendants = self.remote_tree_groups.get(selected_id)
            if descendants is not None:
                pairs = _remote_issue_pairs(
                    descendants,
                    self.current_ticket_mappings,
                )
                state = _aggregate_states(
                    tuple(
                        _remote_asset_summary_state(
                            asset,
                            require_osob=(
                                self.active_table_kind == TABLE_OSOB
                            ),
                        )
                        for asset in descendants
                    )
                )
                self._set_detail(
                    "\n".join(
                        (
                            f"资产数：{len(descendants)}",
                            *_issue_pair_lines(
                                "涉及单号",
                                pairs,
                                self.current_ticket_mappings,
                            ),
                            "",
                            "国内 trunk："
                            f"{_remote_stage_count(descendants, 'domestic')}",
                            "海外 trunk："
                            f"{_remote_stage_count(descendants, 'overseas_trunk')}",
                            "海外 OB："
                            f"{_remote_stage_count(descendants, 'osob')}",
                            "",
                            "展开目录可查看每个资产的提交版本。",
                        )
                    ),
                    issue_state=state,
                )
                return
            asset = self.remote_tree_assets.get(selected_id)
            if asset is None:
                return
            pairs = _remote_issue_pairs(
                (asset,),
                self.current_ticket_mappings,
            )
            state = _remote_asset_summary_state(
                asset,
                require_osob=self.active_table_kind == TABLE_OSOB,
            )
            self._set_detail(
                "\n".join(
                    (
                        f"当前阶段：{asset.stage_label}",
                        "动作一致："
                        f"{'否' if asset.has_action_mismatch else '是'}",
                        f"模块：{asset.module}",
                        "",
                        *_issue_pair_lines(
                            "关联单号",
                            pairs,
                            self.current_ticket_mappings,
                        ),
                        "",
                        "国内 trunk："
                        f"{_remote_evidence_detail(asset.domestic)}",
                        "海外 trunk："
                        f"{_remote_evidence_detail(asset.overseas_trunk)}",
                        "海外 OB："
                        f"{_remote_evidence_detail(asset.osob)}",
                        "",
                        "数据来源：按 Jira 单号查询远端 SVN 提交记录；"
                        "不依赖本地工作副本。",
                    )
                ),
                issue_state=state,
            )
            return
        if self.table_mode == "jira":
            selection = self.table.selection()
            if not selection:
                return
            try:
                items = tuple(
                    self.visible_ticket_progress[int(item_id)]
                    for item_id in selection
                )
            except (ValueError, IndexError):
                return
            item = items[0]
            self.use_ticket_button.configure(
                text=f"核验选中（{len(items)}）"
            )
            source_error = item.source.error or "-"
            target_error = item.target.error or "-"
            self._set_detail(
                "\n".join(
                    (
                        f"当前阶段：{item.stage_label}",
                        f"版本一致性：{item.consistency_label}",
                        "数据来源：Jira 状态与版本登记",
                        "",
                        f"国内单号：{item.mapping.source_issue}",
                        f"国内状态：{item.source.status or '未知'}",
                        f"国内版本：{item.source.version_label}",
                        f"国内创建：{item.source.create_date or '-'}",
                        "",
                        "海外单号："
                        f"{item.mapping.target_issue or item.mapping.source_issue}",
                        f"海外状态：{item.target.status or '未知'}",
                        f"海外版本：{item.target.version_label}",
                        f"海外创建：{item.target.create_date or '-'}",
                        "",
                        f"国内读取错误：{source_error}",
                        f"海外读取错误：{target_error}",
                        "",
                        "Jira 进度适用于无工程查看；"
                        "文件级完成状态仍以 SVN 核验为准。",
                    )
                ),
                issue_state=_jira_summary_state(
                    item,
                    require_osob=self.active_table_kind == TABLE_OSOB,
                ),
            )
            return
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
        selection = self.table.selection()
        if selection and selection[0] in self.audit_tree_cases:
            case = self.audit_tree_cases[selection[0]]
            state = _audit_case_state(case)
            file_groups = self._audit_file_groups(case.files)
            complete = sum(
                _state_is_complete(_audit_group_state(group))
                for group in file_groups
            )
            lines = [
                f"单号状态：{state.label}",
                f"源单号：{case.source_issue}",
                f"目标单号：{case.target_issue or '-'}",
                "任务描述："
                f"{_audit_case_description(case, self.current_ticket_mappings) or '-'}",
                "",
                f"关联资产：{len(file_groups)}",
                f"已完成资产：{complete}",
                f"待处理资产：{len(file_groups) - complete}",
            ]
            if case.warnings:
                lines.extend(("", *case.warnings))
            self._set_detail("\n".join(lines), issue_state=state)
            return
        selection = self.table.selection()
        if selection and selection[0] in self.audit_tree_groups:
            node_id = selection[0]
            files = self.audit_tree_groups[node_id]
            file_groups = self._audit_file_groups(files)
            states = tuple(
                _audit_group_state(group)
                for group in file_groups
            )
            pending = sum(
                not _state_is_complete(state)
                for state in states
            )
            state = _aggregate_states(states)
            self._set_detail(
                "\n".join(
                    (
                        f"资产数：{len(file_groups)}",
                        f"已完成：{len(file_groups) - pending}",
                        f"待处理：{pending}",
                        *_issue_pair_lines(
                            "涉及单号",
                            _audit_issue_pairs(files),
                            self.current_ticket_mappings,
                        ),
                        "",
                        "展开目录可查看每个资产的本地状态和提交证据。",
                    )
                ),
                issue_state=state,
            )
            return
        item = self._selected_item()
        if item is None:
            return
        file_group = self.audit_tree_file_groups.get(
            selection[0],
            (item,),
        )
        if item.expected.target_local_path:
            self.open_path_button.configure(state="normal")
        expected = item.expected
        state = _audit_group_state(file_group)
        reasons = tuple(
            dict.fromkeys(
                grouped_item.reason
                for grouped_item in file_group
                if grouped_item.reason
            )
        )
        source_revisions = sorted(
            {
                revision
                for grouped_item in file_group
                for revision in grouped_item.expected.source_revisions
            }
        )
        source_authors = tuple(
            dict.fromkeys(
                author
                for grouped_item in file_group
                for author in grouped_item.expected.source_authors
            )
        )
        target_revisions = sorted(
            {
                revision
                for grouped_item in file_group
                for revision in grouped_item.target_revisions
            }
        )
        content = "\n".join(
            (
                f"状态：{state.label}",
                f"原因：{'；'.join(reasons) or '-'}",
                "",
                *_issue_pair_lines(
                    "关联单号",
                    _audit_issue_pairs(file_group),
                    self.current_ticket_mappings,
                ),
                f"模块：{expected.module}",
                f"源动作：{expected.action}",
                f"源版本：{', '.join(f'r{x}' for x in source_revisions)}",
                f"源作者：{', '.join(source_authors) or '-'}",
                "",
                f"目标状态：{item.local_status}",
                f"远端状态：{item.repository_status or 'normal'}",
                f"目标版本：{', '.join(f'r{x}' for x in target_revisions) or '-'}",
                f"SVN external：{'是' if expected.is_external else '否'}",
            )
        )
        self._set_detail(content, issue_state=state)

    def _copy_selected_path(self, _event: object = None) -> None:
        if self.table_mode == "remote-assets":
            selection = self.table.selection()
            if not selection:
                return
            asset = self.remote_tree_assets.get(selection[0])
            if asset is None:
                return
            self.root.clipboard_clear()
            self.root.clipboard_append(asset.display_path)
            self.status_text.set("资产路径已复制")
            return
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

    def _set_detail(
        self,
        value: str,
        *,
        issue_state: VerificationState | None = None,
    ) -> None:
        self.detail.configure(state="normal")
        self.detail.delete("1.0", END)
        self.detail.insert("1.0", value)
        if issue_state is not None:
            tag = f"issue-{issue_state.value}"
            for line_number, line in enumerate(value.splitlines(), start=1):
                if ISSUE_KEY_PATTERN.search(line):
                    self.detail.tag_add(
                        tag,
                        f"{line_number}.0",
                        f"{line_number}.end",
                    )
        self.detail.configure(state="disabled")

    def _on_close(self) -> None:
        if self.busy and not messagebox.askyesno(
            "任务执行中",
            "核验任务仍在执行，确定要退出吗？",
        ):
            return
        self._cancel_remote_asset_query()
        self._save_config()
        self.root.destroy()


def _display_relative_path(path: str, root: str) -> str:
    if not path:
        return "-"
    try:
        return str(Path(path).resolve().relative_to(Path(root).resolve()))
    except (OSError, ValueError):
        return path


def _audit_display_path(
    item: FileVerification,
    source_root: str,
    target_root: str,
) -> str:
    expected = item.expected
    if expected.target_local_path:
        value = _display_relative_path(
            expected.target_local_path,
            target_root,
        )
    else:
        value = _display_relative_path(
            expected.source_local_path,
            source_root,
        )
    if value == "-":
        value = expected.target_path or expected.source_path
    return value


def _sheet_tab_marker(sheet_name: str) -> str:
    value = sheet_name.strip()
    year_match = re.search(
        r"(?<!\d)(20\d{2})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?",
        value,
    )
    if year_match:
        year, month, day = map(int, year_match.groups())
        try:
            return date(year, month, day).strftime("%Y/%m/%d")
        except ValueError:
            pass
    compact_match = re.search(r"(?<!\d)(\d{2})(\d{2})(?!\d)", value)
    if compact_match:
        month, day = map(int, compact_match.groups())
        try:
            date(date.today().year, month, day)
            return f"{month:02d}/{day:02d}"
        except ValueError:
            pass
    month_day_match = re.search(
        r"(?<!\d)(\d{1,2})[-/.月](\d{1,2})日?",
        value,
    )
    if month_day_match:
        month, day = map(int, month_day_match.groups())
        try:
            date(date.today().year, month, day)
            return f"{month:02d}/{day:02d}"
        except ValueError:
            pass
    return value[:12] + ("..." if len(value) > 12 else "")


def _jira_query_start(
    issues: tuple[object, ...],
    lookback_days: int,
    *,
    grace_days: int = 3,
) -> date:
    default_start = date.today() - timedelta(days=lookback_days)
    created_dates = []
    for issue in issues:
        value = str(getattr(issue, "create_date", "") or "").strip()
        if not value:
            continue
        try:
            created_dates.append(
                datetime.fromisoformat(
                    value.replace("Z", "+00:00")
                ).date()
            )
        except ValueError:
            continue
    if not created_dates:
        return default_start
    jira_start = min(created_dates) - timedelta(days=grace_days)
    return max(default_start, min(jira_start, date.today()))


def _audit_notices(
    result: MigrationAuditResult | BatchMigrationAuditResult,
) -> tuple[tuple[str, str, str], ...]:
    cases = (
        result.cases
        if isinstance(result, BatchMigrationAuditResult)
        else (result,)
    )
    notices = []
    for case in cases:
        if case.files:
            continue
        reason = (
            "；".join(case.warnings)
            or f"查询范围内未找到 {case.source_issue} 的文件提交"
        )
        issue_pair = (
            f"{case.source_issue} → {case.target_issue}"
            if case.target_issue
            else case.source_issue
        )
        notices.append(
            (
                issue_pair,
                "无源 SVN 变更",
                "\n".join(
                    (
                        "状态：需确认",
                        f"原因：{reason}",
                        "",
                        f"源单号：{case.source_issue}",
                        f"目标单号：{case.target_issue or '-'}",
                        "",
                        "这不表示迁移失败。该任务可能没有 SVN 资产改动，"
                        "也可能使用了其他 Jira 单号提交。",
                        "请确认单号、扫描范围和源 SVN 提交信息。",
                    )
                ),
            )
        )
    return tuple(notices)


def _audit_pending_summary(
    result: MigrationAuditResult | BatchMigrationAuditResult,
) -> str:
    labels = (
        (VerificationState.NOT_MIGRATED, "未迁移"),
        (VerificationState.PENDING_COMMIT, "待提交"),
        (VerificationState.NEEDS_UPDATE, "需更新"),
        (VerificationState.NEEDS_REVIEW, "需确认"),
        (VerificationState.BLOCKED, "阻断"),
    )
    counts = result.counts
    parts = [
        f"{label} {counts.get(state.value, 0)}"
        for state, label in labels
        if counts.get(state.value, 0)
    ]
    notices = _audit_notices(result)
    notice_count = len(notices)
    if notice_count:
        sources = [
            notice[0].split(" → ", 1)[0]
            for notice in notices[:3]
        ]
        suffix = " 等" if notice_count > len(sources) else ""
        parts.append(
            f"无源 SVN 变更 {notice_count} 单"
            f"（{'、'.join(sources)}{suffix}）"
        )
    return " · ".join(parts) or "没有可核验任务"


def _remote_asset_notices(
    mappings: tuple[TicketMapping, ...],
    result: RemoteAssetProgressResult,
) -> tuple[tuple[str, str, str], ...]:
    if result.warnings:
        return ()
    notices = []
    for mapping in mappings:
        has_source_evidence = any(
            mapping.source_issue in asset.source_issues
            and (
                asset.domestic.present
                if mapping.route == TicketRoute.DOMESTIC_TO_OVERSEAS
                else asset.overseas_trunk.present
            )
            for asset in result.assets
        )
        if has_source_evidence:
            continue
        issue_pair = (
            f"{mapping.source_issue} → {mapping.target_issue}"
            if mapping.target_issue
            else mapping.source_issue
        )
        notices.append(
            (
                issue_pair,
                "需确认",
                "\n".join(
                    (
                        "状态：需确认",
                        "原因：源阶段未找到带该 Jira 单号的 SVN 变更",
                        "",
                        f"源单号：{mapping.source_issue}",
                        f"目标单号：{mapping.target_issue or '-'}",
                        "",
                        "这不表示迁移失败。该任务可能没有 SVN 资产改动，"
                        "也可能使用了其他 Jira 单号提交。",
                    )
                ),
            )
        )
    return tuple(notices)


def _state_is_complete(state: VerificationState) -> bool:
    return state in {
        VerificationState.COMPLETE,
        VerificationState.SUBMITTED,
    }


def _count_states(
    states: tuple[VerificationState, ...],
) -> dict[VerificationState, int]:
    counts = {state: 0 for state in VerificationState}
    for state in states:
        counts[state] += 1
    return counts


def _aggregate_states(
    states: tuple[VerificationState, ...],
) -> VerificationState:
    if not states:
        return VerificationState.NEEDS_REVIEW
    if all(_state_is_complete(state) for state in states):
        return VerificationState.COMPLETE
    priority = (
        VerificationState.BLOCKED,
        VerificationState.NOT_MIGRATED,
        VerificationState.NEEDS_UPDATE,
        VerificationState.PENDING_COMMIT,
        VerificationState.NEEDS_REVIEW,
        VerificationState.SUBMITTED,
        VerificationState.COMPLETE,
    )
    available = set(states)
    return next(
        state
        for state in priority
        if state in available
    )


def _audit_cases(
    result: MigrationAuditResult | BatchMigrationAuditResult,
) -> tuple[MigrationAuditResult, ...]:
    if isinstance(result, BatchMigrationAuditResult):
        return result.cases
    return (result,)


def _audit_case_state(
    case: MigrationAuditResult,
) -> VerificationState:
    return _aggregate_states(tuple(item.state for item in case.files))


def _audit_group_state(
    files: list[FileVerification] | tuple[FileVerification, ...],
) -> VerificationState:
    return _aggregate_states(
        tuple(item.state for item in files)
    )


def _audit_issue_pairs(
    files: tuple[FileVerification, ...],
) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            (
                f"{item.expected.source_issue} → "
                f"{item.expected.target_issue or '-'}"
            )
            for item in files
        )
    )


def _compact_issue_key(issue_key: str) -> str:
    prefix, separator, number = issue_key.partition("-")
    if not separator:
        return issue_key
    return f"{prefix[:3].upper()}-{number}"


def _clean_ticket_description(
    candidates: tuple[str, ...],
    issue_keys: tuple[str, ...],
) -> str:
    for candidate in candidates:
        value = candidate.strip()
        for issue_key in issue_keys:
            if issue_key:
                value = re.sub(
                    re.escape(issue_key),
                    "",
                    value,
                    flags=re.IGNORECASE,
                )
        value = value.replace("&&&&", " ")
        value = re.sub(r"[【】\[\]（）()]+", "", value)
        value = re.sub(r"\s+", " ", value)
        value = value.strip(" -—|:：")
        if value:
            return value
    return ""


def _mapping_description(mapping: TicketMapping | None) -> str:
    if mapping is None:
        return ""
    return _clean_ticket_description(
        (mapping.target_text, mapping.source_text),
        (mapping.source_issue, mapping.target_issue),
    )


def _audit_case_description(
    case: MigrationAuditResult,
    mappings: tuple[TicketMapping, ...],
) -> str:
    if case.label:
        description = _clean_ticket_description(
            (case.label,),
            (case.source_issue, case.target_issue),
        )
        if description:
            return description
    return _mapping_description(
        _find_ticket_mapping(
            mappings,
            case.source_issue,
            case.target_issue,
        )
    )


def _find_ticket_mapping(
    mappings: tuple[TicketMapping, ...],
    source_issue: str,
    target_issue: str,
) -> TicketMapping | None:
    exact = next(
        (
            mapping
            for mapping in mappings
            if mapping.source_issue == source_issue
            and mapping.target_issue == target_issue
        ),
        None,
    )
    if exact is not None:
        return exact
    if source_issue == target_issue:
        return next(
            (
                mapping
                for mapping in mappings
                if mapping.target_issue == target_issue
            ),
            None,
        )
    return None


def _ticket_tree_label(
    source_issue: str,
    target_issue: str,
    asset_count: int,
    *,
    description: str = "",
) -> str:
    label = (
        f"{_compact_issue_key(source_issue)} → "
        f"{_compact_issue_key(target_issue) if target_issue else '-'}"
    )
    if description:
        short_description = (
            description
            if len(description) <= 42
            else f"{description[:39]}..."
        )
        label += f" · {short_description}"
    return f"{label} ({asset_count})"


def _issue_pair_lines(
    label: str,
    pairs: tuple[str, ...],
    mappings: tuple[TicketMapping, ...],
) -> tuple[str, ...]:
    if not pairs:
        return (f"{label}：-",)
    descriptions = []
    for pair in pairs:
        source_issue, separator, target_issue = pair.partition(" → ")
        matching_mappings = tuple(
            mapping
            for mapping in mappings
            if mapping.source_issue == source_issue
            and mapping.target_issue == (
                target_issue if separator else ""
            )
        )
        if not matching_mappings:
            matching = _find_ticket_mapping(
                mappings,
                source_issue,
                target_issue if separator else "",
            )
            matching_mappings = (matching,) if matching else ()
        base = (
            f"{_compact_issue_key(source_issue)}"
            + (
                " → "
                f"{_compact_issue_key(target_issue)}"
                if separator
                else ""
            )
        )
        mapping_descriptions = tuple(
            dict.fromkeys(
                description
                for mapping in matching_mappings
                if (description := _mapping_description(mapping))
            )
        )
        if mapping_descriptions:
            descriptions.extend(
                f"{base} · {description}"
                for description in mapping_descriptions
            )
        else:
            descriptions.append(base)
    return (
        f"{label}：",
        *(f"  {description}" for description in descriptions),
    )


def _remote_assets_for_mapping(
    mapping: TicketMapping,
    result: RemoteAssetProgressResult,
) -> tuple[RemoteAssetProgress, ...]:
    target_issue = mapping.target_issue or mapping.source_issue
    return tuple(
        asset
        for asset in result.assets
        if mapping.source_issue in asset.source_issues
        and target_issue in asset.target_issues
    )


def _remote_mapping_state(
    mapping: TicketMapping,
    assets: tuple[RemoteAssetProgress, ...],
    *,
    require_osob: bool,
) -> VerificationState:
    if not assets:
        return VerificationState.NEEDS_REVIEW
    has_source_evidence = any(
        (
            asset.domestic.present
            if mapping.route == TicketRoute.DOMESTIC_TO_OVERSEAS
            else asset.overseas_trunk.present
        )
        for asset in assets
    )
    if not has_source_evidence:
        return VerificationState.NEEDS_REVIEW
    return _aggregate_states(
        tuple(
            _remote_asset_summary_state(
                asset,
                require_osob=require_osob,
            )
            for asset in assets
        )
    )


def _remote_stage_count(
    assets: tuple[RemoteAssetProgress, ...],
    stage: str,
) -> str:
    if not assets:
        return "-"
    done = sum(
        getattr(asset, stage).present
        for asset in assets
    )
    return f"{done}/{len(assets)}"


def _remote_issue_pairs(
    assets: tuple[RemoteAssetProgress, ...],
    mappings: tuple[TicketMapping, ...],
) -> tuple[str, ...]:
    matched = tuple(
        (
            f"{mapping.source_issue} → "
            f"{mapping.target_issue or '-'}"
        )
        for mapping in mappings
        if any(
            mapping.source_issue in asset.source_issues
            and (
                mapping.target_issue or mapping.source_issue
            )
            in asset.target_issues
            for asset in assets
        )
    )
    if matched:
        return tuple(dict.fromkeys(matched))
    return tuple(
        dict.fromkeys(
            issue
            for asset in assets
            for issue in (
                *asset.source_issues,
                *asset.target_issues,
            )
        )
    )


def _ticket_commit_message(mapping: TicketMapping) -> str:
    title = mapping.target_text.strip()
    if mapping.target_issue.casefold() in title.casefold():
        return title
    if title:
        return f"【{mapping.target_issue}】{title}"
    return f"【{mapping.target_issue}】"


def _jira_progress_tag(item: TicketJiraProgress) -> str:
    if not item.source.available or not item.target.available:
        return "jira-unknown"
    if item.consistency_label == "版本异常":
        return "jira-warning"
    if item.target.has_osob:
        return "jira-osob"
    if item.target.has_trunk:
        return "jira-trunk"
    if item.source.has_trunk:
        return "jira-domestic"
    return "jira-unknown"


def _jira_summary_state(
    item: TicketJiraProgress,
    *,
    require_osob: bool,
) -> VerificationState:
    if (
        not item.source.available
        or not item.target.available
        or item.consistency_label == "版本异常"
    ):
        return VerificationState.BLOCKED
    if require_osob:
        if item.target.has_osob:
            return VerificationState.COMPLETE
        if item.target.has_trunk or item.source.has_trunk:
            return VerificationState.PENDING_COMMIT
        return VerificationState.NOT_MIGRATED
    if item.target.has_trunk or item.target.has_osob:
        return VerificationState.COMPLETE
    if item.source.has_trunk:
        return VerificationState.PENDING_COMMIT
    return VerificationState.NOT_MIGRATED


def _filter_matches(
    selected_filter: str,
    state: VerificationState,
) -> bool:
    if selected_filter == "全部":
        return True
    if selected_filter == "已完成":
        return _state_is_complete(state)
    if selected_filter == "待处理":
        return state in {
            VerificationState.NOT_MIGRATED,
            VerificationState.PENDING_COMMIT,
            VerificationState.NEEDS_UPDATE,
            VerificationState.NEEDS_REVIEW,
        }
    return state.label == selected_filter


def _remote_stage_label(stage: str) -> str:
    return {
        "osob": "海外 OB",
        "overseas_trunk": "海外 trunk",
        "domestic": "国内 trunk",
        "partial": "部分完成",
        "warning": "动作不一致",
        "empty": "-",
    }.get(stage, stage)


def _remote_asset_summary_state(
    asset: RemoteAssetProgress,
    *,
    require_osob: bool,
) -> VerificationState:
    if asset.has_action_mismatch:
        return VerificationState.BLOCKED
    if (
        asset.osob.present
        if require_osob
        else asset.overseas_trunk.present or asset.osob.present
    ):
        return VerificationState.COMPLETE
    if asset.overseas_trunk.present or asset.domestic.present:
        return VerificationState.PENDING_COMMIT
    return VerificationState.NOT_MIGRATED


def _remote_evidence_detail(evidence: BranchEvidence) -> str:
    if not evidence.present:
        return "无提交"
    revisions = ", ".join(f"r{value}" for value in evidence.revisions)
    authors = "、".join(evidence.authors) or "-"
    return (
        f"{evidence.action or '?'} | {revisions} | "
        f"{authors}"
    )


def main() -> None:
    _enable_windows_dpi_awareness()
    root = Tk()
    MigrationGuardApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
