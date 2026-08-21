from datetime import datetime
from pathlib import Path
import threading
import webbrowser
from tkinter import BOTH, LEFT, RIGHT, X, Y, StringVar, Tk, filedialog, messagebox, ttk
from typing import Any

from .character_catalog import (
    CharacterCatalogService,
    CharacterIndex,
    CharacterProfile,
    LarkAuthenticationRequired,
)
from .character_detail import CharacterDetailWindow
from .dpi import configure_tk_dpi, get_window_dpi, get_work_area, window_geometry
from .interactions import ClickArbiter
from .local_character_content import (
    LocalCharacterContentError,
    LocalCharacterContentRepository,
)
from .models import (
    NpcRecord,
    QueryKey,
    QueryKind,
    QueryResult,
    ResourceRecord,
    TargetRecord,
)
from .query_service import NotFoundError, QueryService
from .repository import CsvDataError, CsvRepository
from .settings import (
    AppSettings,
    csv_directory,
    load_settings,
    normalize_doc_directory,
    save_settings,
    validate_doc_directory,
)
from .theme import configure_styles
from .update_controller import (
    ConfigLinkerUpdateController,
    ModuleManifest,
    PreparedUpdate,
    UpdateCheckResult,
)
from .view_state import QueryHistory, ResultPager


QUERY_LABEL_TO_KIND = {
    "目标物 ID": QueryKind.TARGET,
    "NPC ID": QueryKind.NPC,
    "模型资源 ID": QueryKind.RESOURCE,
}
KIND_TO_QUERY_LABEL = {kind: label for label, kind in QUERY_LABEL_TO_KIND.items()}

CARD_COLUMNS = {
    QueryKind.TARGET: (
        ("id", "目标物 ID", 82),
        ("type", "类型", 76),
        ("description", "描述", 160),
        ("npc_id", "NPC ID", 76),
    ),
    QueryKind.NPC: (
        ("id", "NPC ID", 76),
        ("note", "备注", 100),
        ("name", "名称", 108),
        ("resource_id", "资源 ID", 78),
    ),
    QueryKind.RESOURCE: (
        ("id", "资源 ID", 100),
        ("configured_path", "配置路径", 620),
    ),
}


class ConfigLinkerApp:
    def __init__(
        self,
        root: Tk,
        *,
        config_path: Path | None = None,
        auto_load: bool = True,
        app_version: str = "1.3.0",
        update_controller: ConfigLinkerUpdateController | None = None,
        character_service: CharacterCatalogService | None = None,
        character_content_repository: (
            LocalCharacterContentRepository | None
        ) = None,
        auto_refresh_characters: bool | None = None,
    ) -> None:
        self.root = root
        self.current_dpi = configure_tk_dpi(self.root)
        self.root.title("配置关系检索器")
        self._set_initial_window_geometry()

        self.config_path = Path(config_path or "config_linker_config.json")
        self.settings, settings_warning = load_settings(self.config_path)
        self.repository: CsvRepository | None = None
        self.query_service: QueryService | None = None
        self.history = QueryHistory()
        self.current_result: QueryResult | None = None
        self.last_error = ""
        self.current_theme = ""
        self.app_version = app_version
        self.update_controller = update_controller
        self.update_state = "idle"
        self.update_manifest: ModuleManifest | None = None
        self.update_error = ""
        self.character_service = (
            character_service
            if character_service is not None
            else (
                CharacterCatalogService.create_default()
                if auto_load
                else None
            )
        )
        self.character_refreshing = False
        self.character_content_repository = character_content_repository
        self.character_content_error = ""
        self.selected_record: Any = None
        self.selected_character_profile: CharacterProfile | None = None
        self.character_window: CharacterDetailWindow | None = None

        self.style = ttk.Style()
        self.colors = configure_styles(self.root, self.style, self._should_use_dark_theme())

        self.query_type = StringVar(value="目标物 ID")
        self.query_value = StringVar(value="")
        self.status_text = StringVar(value="等待加载数据")
        self.data_directory_text = StringVar(value=str(self.settings.doc_directory))
        self.message_text = StringVar(value=settings_warning or "输入任意一种 ID 开始查询")
        self.detail_text = StringVar(value="选择任意结果行可查看完整信息")
        self.resource_path_text = StringVar(value="")
        self.target_position_text = StringVar(value="")
        self.target_rotation_text = StringVar(value="")
        self.toast_text = StringVar(value="")
        self.version_text = StringVar(value=f"v{self.app_version}")
        self.character_status_text = StringVar(
            value=self._character_status_summary()
        )
        self.toast_label: ttk.Label | None = None
        self.toast_job: str | None = None
        self.click_arbiter = ClickArbiter(self.root.after, self.root.after_cancel)

        self.result_trees: dict[QueryKind, ttk.Treeview] = {}
        self.horizontal_scrollbars: dict[QueryKind, ttk.Scrollbar] = {}
        self.record_maps: dict[QueryKind, dict[str, Any]] = {}
        self.card_borders: dict[QueryKind, ttk.Frame] = {}
        self.card_meta: dict[QueryKind, StringVar] = {}
        self.card_focus: dict[QueryKind, StringVar] = {}
        self.load_more_buttons: dict[QueryKind, ttk.Button] = {}
        self.pagers: dict[QueryKind, ResultPager] = {}

        self._build_ui()
        self._apply_theme(force=True)
        self._render_all_cards()
        self._update_back_button()
        self.root.after(1000, self._dpi_tick)
        self.root.after(60_000, self._theme_tick)
        if self.update_controller is not None:
            self.root.after(1500, self._check_for_updates_async)
        should_refresh_characters = (
            auto_load
            if auto_refresh_characters is None
            else auto_refresh_characters
        )
        if (
            should_refresh_characters
            and self.character_service is not None
            and not self.character_service.index_is_fresh()
        ):
            self.root.after(
                2200,
                lambda: self._refresh_character_index_async(notify=False),
            )

        if settings_warning:
            self._set_message(settings_warning, "warning")
        if auto_load:
            self.root.after(30, self.reload_data)

    def _set_initial_window_geometry(self) -> None:
        work_area = get_work_area(self.root)
        geometry = window_geometry(
            dpi=self.current_dpi,
            screen_width=self.root.winfo_screenwidth(),
            screen_height=self.root.winfo_screenheight(),
            work_width=work_area.width,
            work_height=work_area.height,
        )
        x = work_area.left + max(0, (work_area.width - geometry.width) // 2)
        y = work_area.top + max(0, (work_area.height - geometry.height) // 2)
        self.root.geometry(f"{geometry.width}x{geometry.height}+{x}+{y}")
        self.root.minsize(geometry.minimum_width, geometry.minimum_height)

    def _build_ui(self) -> None:
        main = ttk.Frame(self.root, style="App.TFrame", padding=(18, 14, 18, 12))
        main.pack(fill=BOTH, expand=True)

        header = ttk.Frame(main, style="App.TFrame")
        header.pack(fill=X)
        title_block = ttk.Frame(header, style="App.TFrame")
        title_block.pack(side=LEFT)
        ttk.Label(title_block, text="配置关系检索器", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            title_block,
            text="目标物  ·  NPC  ·  模型资源",
            style="Subtitle.TLabel",
        ).pack(anchor="w")

        header_actions = ttk.Frame(header, style="App.TFrame")
        header_actions.pack(side=RIGHT)
        ttk.Label(
            header_actions,
            textvariable=self.version_text,
            style="AppMuted.TLabel",
        ).pack(side=LEFT, padx=(0, 4))
        self.update_dot = ttk.Label(
            header_actions,
            text="○",
            style="UpdateDot.TLabel",
            cursor="hand2",
        )
        self.update_dot.pack(side=LEFT, padx=(0, 10))
        self.update_dot.bind(
            "<Button-1>",
            lambda _event: self._on_update_dot_clicked(),
        )
        self.status_label = ttk.Label(
            header_actions,
            textvariable=self.status_text,
            style="StatusWarn.TLabel",
        )
        self.status_label.pack(side=LEFT, padx=(0, 10))
        ttk.Button(
            header_actions,
            text="重新加载",
            style="Subtle.TButton",
            command=self.reload_data,
        ).pack(side=LEFT)

        toolbar = ttk.Frame(main, style="App.TFrame")
        toolbar.pack(fill=X, pady=(12, 7))
        self.back_button = ttk.Button(
            toolbar,
            text="← 返回上一步",
            style="Subtle.TButton",
            command=self.go_back,
        )
        self.back_button.pack(side=LEFT)
        self.choose_doc_button = ttk.Button(
            toolbar,
            text="选择 doc 目录",
            style="Subtle.TButton",
            command=self.choose_data_directory,
        )
        self.choose_doc_button.pack(side=LEFT, padx=(7, 0))
        ttk.Button(
            toolbar,
            text="复制诊断信息",
            style="Subtle.TButton",
            command=self.copy_diagnostics,
        ).pack(side=LEFT, padx=(7, 0))
        self.refresh_character_button = ttk.Button(
            toolbar,
            text="同步角色档案",
            style="Subtle.TButton",
            command=lambda: self._refresh_character_index_async(notify=True),
        )
        self.refresh_character_button.pack(side=LEFT, padx=(7, 0))
        if self.character_service is None:
            self.refresh_character_button.configure(state="disabled")
        ttk.Label(
            toolbar,
            textvariable=self.data_directory_text,
            style="AppMuted.TLabel",
        ).pack(side=RIGHT)
        ttk.Label(
            toolbar,
            textvariable=self.character_status_text,
            style="AppMuted.TLabel",
        ).pack(side=RIGHT, padx=(0, 12))

        search_card = ttk.Frame(main, style="Card.TFrame", padding=(14, 11))
        search_card.pack(fill=X, pady=(0, 10))
        search_controls = ttk.Frame(search_card, style="Card.TFrame")
        search_controls.pack(anchor="center")
        ttk.Label(
            search_controls,
            text="查询中心",
            style="Section.TLabel",
        ).pack(side=LEFT, padx=(0, 12))
        self.query_combo = ttk.Combobox(
            search_controls,
            values=list(QUERY_LABEL_TO_KIND),
            textvariable=self.query_type,
            state="readonly",
            width=15,
        )
        self.query_combo.pack(side=LEFT)
        self.query_entry = ttk.Entry(
            search_controls,
            textvariable=self.query_value,
            width=26,
        )
        self.query_entry.pack(side=LEFT, padx=8)
        self.query_entry.bind("<Return>", lambda _event: self.search_from_input())
        ttk.Button(
            search_controls,
            text="搜索",
            style="Accent.TButton",
            command=self.search_from_input,
        ).pack(side=LEFT)

        relationship = ttk.Frame(main, style="App.TFrame")
        relationship.pack(fill=BOTH, expand=True)
        for column in (0, 2, 4):
            relationship.grid_columnconfigure(column, weight=1, uniform="cards")
        relationship.grid_rowconfigure(0, weight=1)

        self._build_result_card(relationship, QueryKind.TARGET, "目标物", 0)
        ttk.Label(relationship, text="→", style="Arrow.TLabel").grid(
            row=0,
            column=1,
            padx=7,
        )
        self._build_result_card(relationship, QueryKind.NPC, "NPC", 2)
        ttk.Label(relationship, text="→", style="Arrow.TLabel").grid(
            row=0,
            column=3,
            padx=7,
        )
        self._build_result_card(relationship, QueryKind.RESOURCE, "模型资源", 4)

        message_row = ttk.Frame(main, style="App.TFrame")
        message_row.pack(fill=X, pady=(8, 5))
        self.message_label = ttk.Label(
            message_row,
            textvariable=self.message_text,
            style="Message.TLabel",
        )
        self.message_label.pack(side=LEFT)

        detail_card = ttk.Frame(main, style="Card.TFrame", padding=(12, 8))
        detail_card.pack(fill=X)
        detail_header = ttk.Frame(detail_card, style="Card.TFrame")
        detail_header.pack(fill=X)
        ttk.Label(
            detail_header,
            text="选中详情",
            style="Section.TLabel",
        ).pack(side=LEFT)
        self.character_detail_button = ttk.Button(
            detail_header,
            text="角色详情",
            style="Accent.TButton",
            command=self._open_character_detail,
        )
        self.detail_label = ttk.Label(
            detail_card,
            textvariable=self.detail_text,
            style="Muted.TLabel",
            justify="left",
            wraplength=1110,
        )
        self.detail_label.pack(fill=X, anchor="w", pady=(3, 0))
        self.resource_detail_frame = ttk.Frame(detail_card, style="Card.TFrame")
        ttk.Label(
            self.resource_detail_frame,
            text="配置路径",
            style="Muted.TLabel",
        ).pack(side=LEFT, padx=(0, 8))
        self.resource_path_entry = ttk.Entry(
            self.resource_detail_frame,
            textvariable=self.resource_path_text,
            state="readonly",
        )
        self.resource_path_entry.pack(side=LEFT, fill=X, expand=True)
        self.target_detail_frame = ttk.Frame(detail_card, style="Card.TFrame")
        ttk.Label(
            self.target_detail_frame,
            text="坐标",
            style="Muted.TLabel",
        ).grid(row=0, column=0, sticky="w", padx=(0, 8), pady=(3, 0))
        self.target_position_entry = ttk.Entry(
            self.target_detail_frame,
            textvariable=self.target_position_text,
            state="readonly",
        )
        self.target_position_entry.grid(
            row=0,
            column=1,
            sticky="ew",
            padx=(0, 16),
            pady=(3, 0),
        )
        ttk.Label(
            self.target_detail_frame,
            text="旋转",
            style="Muted.TLabel",
        ).grid(row=0, column=2, sticky="w", padx=(0, 8), pady=(3, 0))
        self.target_rotation_entry = ttk.Entry(
            self.target_detail_frame,
            textvariable=self.target_rotation_text,
            state="readonly",
        )
        self.target_rotation_entry.grid(row=0, column=3, sticky="ew", pady=(3, 0))
        self.target_detail_frame.grid_columnconfigure(
            1,
            weight=1,
            uniform="location",
        )
        self.target_detail_frame.grid_columnconfigure(
            3,
            weight=1,
            uniform="location",
        )
        self.target_position_entry.bind(
            "<Double-1>",
            lambda _event: self._copy_text(
                self.target_position_text.get(),
                "坐标",
            )
            or "break",
        )
        self.target_rotation_entry.bind(
            "<Double-1>",
            lambda _event: self._copy_text(
                self.target_rotation_text.get(),
                "旋转",
            )
            or "break",
        )

    def _check_for_updates_async(self) -> None:
        if self.update_controller is None:
            return
        if self.update_state in {"checking", "downloading"}:
            return
        self.update_state = "checking"
        self.update_error = ""
        self._refresh_update_dot()
        threading.Thread(
            target=self._check_for_updates_worker,
            daemon=True,
        ).start()

    def _refresh_character_index_async(self, *, notify: bool) -> None:
        if self.character_service is None or self.character_refreshing:
            return
        self.character_refreshing = True
        self.refresh_character_button.configure(state="disabled")
        self.character_status_text.set("角色资料：正在同步...")
        threading.Thread(
            target=self._refresh_character_index_worker,
            args=(notify,),
            daemon=True,
        ).start()

    def _character_status_summary(
        self,
        *,
        base_unavailable: bool = False,
    ) -> str:
        if self.character_service is None:
            base_status = "档案未启用"
        else:
            count = self.character_service.cache.profile_count()
            if count:
                base_status = f"{count} 名"
            elif base_unavailable:
                base_status = "档案不可用"
            else:
                base_status = "档案未同步"
        local_status = (
            "本地内容就绪"
            if self.character_content_repository is not None
            else "本地内容未加载"
        )
        return f"角色资料：{base_status} · {local_status}"

    def _refresh_character_index_worker(self, notify: bool) -> None:
        if self.character_service is None:
            return
        try:
            index = self.character_service.refresh_index()
        except Exception as exc:
            self.root.after(
                0,
                lambda error=exc: self._character_index_failed(error, notify),
            )
            return
        self.root.after(
            0,
            lambda: self._character_index_ready(index, notify),
        )

    def _character_index_ready(
        self,
        index: CharacterIndex,
        notify: bool,
    ) -> None:
        self.character_refreshing = False
        self.refresh_character_button.configure(state="normal")
        self.character_status_text.set(self._character_status_summary())
        self._update_character_action(self.selected_record)
        if notify:
            self._set_message(
                f"命名角色资料更新完成：{len(index.profiles)} 名",
                "normal",
            )

    def _character_index_failed(
        self,
        error: Exception,
        notify: bool,
    ) -> None:
        self.character_refreshing = False
        self.refresh_character_button.configure(state="normal")
        if (
            self.character_service is not None
            and self.character_service.cache.profile_count() > 0
        ):
            self.character_status_text.set(self._character_status_summary())
        else:
            self.character_status_text.set(
                self._character_status_summary(base_unavailable=True)
            )
        if notify and isinstance(error, LarkAuthenticationRequired):
            if messagebox.askyesno(
                "连接飞书",
                "角色资料需要飞书只读授权。是否打开授权页面？",
                parent=self.root,
            ):
                self._authorize_character_access_async()
            return
        if notify:
            self._set_message(f"角色资料刷新失败：{error}", "error")

    def _authorize_character_access_async(self) -> None:
        if self.character_service is None or self.character_refreshing:
            return
        self.character_refreshing = True
        self.refresh_character_button.configure(state="disabled")
        self.character_status_text.set("角色资料：等待飞书授权...")
        threading.Thread(
            target=self._authorize_character_access_worker,
            daemon=True,
        ).start()

    def _authorize_character_access_worker(self) -> None:
        if self.character_service is None:
            return
        try:
            request = self.character_service.begin_login()
            self.root.after(
                0,
                lambda: self._open_lark_authorization(
                    request.verification_url
                ),
            )
            self.character_service.complete_login(request.device_code)
            index = self.character_service.refresh_index()
        except Exception as exc:
            self.root.after(
                0,
                lambda error=exc: self._character_index_failed(error, True),
            )
            return
        self.root.after(
            0,
            lambda: self._character_index_ready(index, True),
        )

    def _open_lark_authorization(self, url: str) -> None:
        opened = webbrowser.open(url)
        message = (
            "已在浏览器中打开飞书授权页面。完成授权后，"
            "角色资料会自动刷新。"
            if opened
            else f"请在浏览器中打开以下地址完成授权：\n\n{url}"
        )
        messagebox.showinfo("飞书授权", message, parent=self.root)

    def _check_for_updates_worker(self) -> None:
        if self.update_controller is None:
            return
        result = self.update_controller.check()
        self.root.after(
            0,
            lambda: self._apply_update_check_result(result),
        )

    def _apply_update_check_result(
        self,
        result: UpdateCheckResult,
    ) -> None:
        self.update_state = result.state
        self.update_manifest = result.manifest
        self.update_error = result.message
        self._refresh_update_dot()

    def _refresh_update_dot(self) -> None:
        self.version_text.set(
            f"v{self.app_version}"
            + (
                " · 更新检查失败"
                if self.update_state == "failed"
                else ""
            )
        )
        if self.update_state == "ready":
            self.update_dot.configure(
                text="●",
                style="UpdateDotReady.TLabel",
            )
        elif self.update_state in {"checking", "downloading"}:
            self.update_dot.configure(
                text="◌",
                style="UpdateDot.TLabel",
            )
        else:
            self.update_dot.configure(
                text="○",
                style="UpdateDot.TLabel",
            )

    def _on_update_dot_clicked(self) -> None:
        if self.update_controller is None:
            messagebox.showinfo(
                "独立更新",
                "源码模式不执行自更新，请使用发布版 ConfigLinker.exe。",
                parent=self.root,
            )
            return
        if self.update_state == "checking":
            messagebox.showinfo(
                "检查更新",
                "正在检查更新，请稍后。",
                parent=self.root,
            )
            return
        if self.update_state == "downloading":
            messagebox.showinfo(
                "正在更新",
                "正在下载并校验更新包，请稍后。",
                parent=self.root,
            )
            return
        if self.update_state != "ready" or self.update_manifest is None:
            self._check_for_updates_async()
            return
        if not messagebox.askyesno(
            "发现新版本",
            f"发现 ConfigLinker v{self.update_manifest.version}，"
            "是否下载更新？",
            parent=self.root,
        ):
            return
        self.update_state = "downloading"
        self._refresh_update_dot()
        manifest = self.update_manifest
        threading.Thread(
            target=self._prepare_update_worker,
            args=(manifest,),
            daemon=True,
        ).start()

    def _prepare_update_worker(self, manifest: ModuleManifest) -> None:
        if self.update_controller is None:
            return
        try:
            prepared = self.update_controller.prepare_update(manifest)
        except Exception as exc:
            message = str(exc)
            self.root.after(
                0,
                lambda: self._update_prepare_failed(message),
            )
            return
        self.root.after(
            0,
            lambda: self._confirm_apply_update(prepared),
        )

    def _update_prepare_failed(self, message: str) -> None:
        self.update_state = "ready"
        self.update_error = message
        self._refresh_update_dot()
        messagebox.showerror(
            "更新失败",
            f"更新包下载或校验失败：{message}",
            parent=self.root,
        )

    def _confirm_apply_update(self, prepared: PreparedUpdate) -> None:
        self.update_state = "ready"
        self._refresh_update_dot()
        if not messagebox.askyesno(
            "更新已准备完成",
            f"ConfigLinker v{prepared.version} 已下载并通过校验。"
            "是否立即重启并应用更新？",
            parent=self.root,
        ):
            return
        if self.update_controller is None:
            return
        try:
            self.update_controller.launch_prepared_update(prepared)
        except OSError as exc:
            self._update_prepare_failed(str(exc))
            return
        self.root.destroy()

    def _build_result_card(
        self,
        parent: ttk.Frame,
        kind: QueryKind,
        title: str,
        column: int,
    ) -> None:
        border = ttk.Frame(parent, style="CardBorder.TFrame", padding=1)
        border.grid(row=0, column=column, sticky="nsew")
        self.card_borders[kind] = border

        card = ttk.Frame(border, style="Card.TFrame", padding=(10, 9))
        card.pack(fill=BOTH, expand=True)
        card_header = ttk.Frame(card, style="Card.TFrame")
        card_header.pack(fill=X, pady=(0, 7))
        ttk.Label(card_header, text=title, style="Section.TLabel").pack(side=LEFT)
        focus = StringVar(value="")
        self.card_focus[kind] = focus
        ttk.Label(
            card_header,
            textvariable=focus,
            style="FocusBadge.TLabel",
        ).pack(side=LEFT, padx=(7, 0))
        meta = StringVar(value="0 条")
        self.card_meta[kind] = meta
        ttk.Label(card_header, textvariable=meta, style="Muted.TLabel").pack(side=RIGHT)

        columns = tuple(column_id for column_id, _heading, _width in CARD_COLUMNS[kind])
        tree_frame = ttk.Frame(card, style="Card.TFrame")
        tree_frame.pack(fill=BOTH, expand=True)
        tree = ttk.Treeview(
            tree_frame,
            columns=columns,
            show="headings",
            style="Result.Treeview",
            height=10,
            selectmode="browse",
        )
        for column_id, heading, width in CARD_COLUMNS[kind]:
            tree.heading(column_id, text=heading)
            tree.column(
                column_id,
                width=width,
                minwidth=54,
                stretch=kind != QueryKind.RESOURCE,
                anchor="w",
            )
        scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=tree.yview)
        tree.configure(yscrollcommand=scrollbar.set)
        tree.pack(side=LEFT, fill=BOTH, expand=True)
        scrollbar.pack(side=RIGHT, fill=Y)
        if kind == QueryKind.RESOURCE:
            horizontal = ttk.Scrollbar(card, orient="horizontal", command=tree.xview)
            tree.configure(xscrollcommand=horizontal.set)
            horizontal.pack(fill=X, pady=(5, 0))
            self.horizontal_scrollbars[kind] = horizontal
        tree.bind(
            "<ButtonRelease-1>",
            lambda event, card_kind=kind: self._on_tree_click(event, card_kind),
        )
        tree.bind(
            "<Double-1>",
            lambda event, card_kind=kind: self._on_tree_double_click(
                event,
                card_kind,
            ),
        )
        tree.bind("<Motion>", lambda event, card_kind=kind: self._on_tree_motion(event, card_kind))
        tree.bind("<Leave>", lambda _event, widget=tree: widget.configure(cursor=""))
        tree.bind("<<TreeviewSelect>>", lambda _event, card_kind=kind: self._show_selected_detail(card_kind))
        self.result_trees[kind] = tree
        self.record_maps[kind] = {}

        button = ttk.Button(
            card,
            text="加载更多",
            style="Subtle.TButton",
            command=lambda card_kind=kind: self._load_more(card_kind),
        )
        button.pack(anchor="e", pady=(7, 0))
        self.load_more_buttons[kind] = button

    def search_from_input(self) -> None:
        raw_value = self.query_value.get().strip()
        if not raw_value:
            self._set_message("请输入 ID", "error")
            return
        try:
            value = int(raw_value)
        except ValueError:
            self._set_message("ID 必须是整数", "error")
            return
        kind = QUERY_LABEL_TO_KIND[self.query_type.get()]
        self.visit_query(QueryKey(kind, value))

    def visit_query(self, key: QueryKey) -> None:
        self._run_query(key, add_history=True)

    def _run_query(self, key: QueryKey, *, add_history: bool) -> None:
        if self.query_service is None:
            self._set_message("数据尚未加载，请先重新加载", "error")
            return
        try:
            result = self.query_service.search(key)
        except NotFoundError as exc:
            self._set_message(str(exc), "error")
            return

        if add_history:
            self.history.visit(key)
        self.current_result = result
        self.query_type.set(KIND_TO_QUERY_LABEL[key.kind])
        self.query_value.set(str(key.value))
        self.detail_text.set("选择任意结果行可查看完整信息")
        self._update_character_action(None)
        self._render_all_cards()
        self._update_back_button()
        if result.warnings:
            self._set_message("；".join(result.warnings), "warning")
        else:
            self._set_message(
                f"查询完成：目标物 {len(result.targets)}，NPC {len(result.npcs)}，资源 {len(result.resources)}",
                "normal",
            )

    def go_back(self) -> None:
        key = self.history.back()
        if key is None:
            self._update_back_button()
            return
        self._run_query(key, add_history=False)

    def reload_data(self) -> None:
        self.status_text.set("正在加载数据...")
        self.status_label.configure(style="StatusWarn.TLabel")
        self.root.update_idletasks()
        target_csv_directory = csv_directory(self.settings)
        try:
            new_repository = CsvRepository.load(target_csv_directory)
        except (OSError, CsvDataError, UnicodeError) as exc:
            self.last_error = str(exc)
            if self.repository is None:
                self.status_text.set("数据加载失败")
                message = f"加载失败：{exc}"
            else:
                self.status_text.set("刷新失败，仍使用旧数据")
                message = f"刷新失败，当前仍使用旧数据：{exc}"
            self.status_label.configure(style="StatusError.TLabel")
            self._set_message(message, "error")
            return

        content_error = ""
        try:
            new_character_content = LocalCharacterContentRepository.load(
                target_csv_directory
            )
        except (
            OSError,
            UnicodeError,
            LocalCharacterContentError,
        ) as exc:
            content_error = str(exc)
            new_character_content = (
                self.character_content_repository
                if (
                    self.character_content_repository is not None
                    and self.character_content_repository.directory
                    == target_csv_directory
                )
                else None
            )

        self.repository = new_repository
        self.query_service = QueryService(new_repository)
        self.character_content_repository = new_character_content
        self.character_content_error = content_error
        self.last_error = ""
        report = new_repository.report
        self.status_text.set(
            f"已加载 {report.target_count} / {report.npc_count} / {report.resource_count}"
        )
        self.status_label.configure(style="StatusGood.TLabel")
        self.data_directory_text.set(str(self.settings.doc_directory))
        self.character_status_text.set(self._character_status_summary())
        if content_error:
            self._set_message(
                "基础数据加载成功；角色本地内容不可用："
                f"{content_error}",
                "warning",
            )
        else:
            self._set_message(
                f"数据加载成功：目标物 {report.target_count}，"
                f"NPC {report.npc_count}，资源 {report.resource_count}",
                "normal",
            )
        if self.history.current is not None:
            self._run_query(self.history.current, add_history=False)

    def choose_data_directory(self) -> None:
        messagebox.showinfo(
            "选择 doc 目录",
            "请选择配置仓的 doc 根目录。\n"
            "程序会读取 doc\\csvdir 下的基础关系表；"
            "角色页还会读取对话表、开始节点和任务表。\n\n"
            "如果误选 csvdir，程序也会自动识别。",
            parent=self.root,
        )
        selected = filedialog.askdirectory(
            title="选择配置仓 doc 根目录",
            initialdir=str(self.settings.doc_directory),
        )
        if not selected:
            return
        doc_directory, missing = validate_doc_directory(Path(selected))
        if doc_directory is None:
            message = "所选目录中未找到以下路径：\n" + "\n".join(missing)
            self._set_message(message.replace("\n", "；"), "error")
            messagebox.showerror(
                "doc 目录无效",
                message,
                parent=self.root,
            )
            return
        new_settings = AppSettings(normalize_doc_directory(doc_directory))
        try:
            save_settings(self.config_path, new_settings)
        except OSError as exc:
            self._set_message(f"保存数据目录失败：{exc}", "error")
            return
        self.settings = new_settings
        self.data_directory_text.set(str(self.settings.doc_directory))
        self.reload_data()

    def copy_diagnostics(self) -> None:
        diagnostic = self._diagnostic_text()
        self.root.clipboard_clear()
        self.root.clipboard_append(diagnostic)
        self._set_message("诊断信息已复制", "normal")

    def _diagnostic_text(self) -> str:
        lines = [
            "配置关系检索器诊断信息",
            f"doc 目录：{self.settings.doc_directory}",
            f"状态：{self.status_text.get()}",
        ]
        if self.repository is not None:
            report = self.repository.report
            lines.extend(
                [
                    f"加载时间：{report.loaded_at:%Y-%m-%d %H:%M:%S}",
                    f"记录数：目标物={report.target_count}, NPC={report.npc_count}, 资源={report.resource_count}",
                ]
            )
        if self.current_result is not None:
            key = self.current_result.key
            lines.append(f"当前查询：{key.kind.value} {key.value}")
            if self.current_result.warnings:
                lines.append(f"查询告警：{'；'.join(self.current_result.warnings)}")
        lines.append(f"角色资料：{self.character_status_text.get()}")
        if self.character_content_repository is not None:
            content_report = self.character_content_repository.report
            lines.append(
                "角色本地内容："
                f"台词={content_report.dialogue_count}, "
                f"剧情={content_report.story_count}, "
                f"任务={content_report.task_count}"
            )
        if self.character_content_error:
            lines.append(
                f"角色本地内容错误：{self.character_content_error}"
            )
        if self.last_error:
            lines.append(f"最近错误：{self.last_error}")
        return "\n".join(lines)

    def _render_all_cards(self) -> None:
        for kind in QueryKind:
            records = self._records_for_kind(kind)
            self.pagers[kind] = ResultPager(len(records))
            self._render_card(kind)
            is_active = self.current_result is not None and self.current_result.key.kind == kind
            if is_active:
                self.card_focus[kind].set(
                    f"查询中心 · {self.current_result.key.value}"
                )
            else:
                self.card_focus[kind].set("")
            self.card_borders[kind].configure(
                style="ActiveCardBorder.TFrame" if is_active else "CardBorder.TFrame"
            )

    def _render_card(self, kind: QueryKind) -> None:
        tree = self.result_trees[kind]
        tree.delete(*tree.get_children())
        self.record_maps[kind].clear()
        records = self._records_for_kind(kind)
        pager = self.pagers.get(kind, ResultPager(len(records)))
        self.pagers[kind] = pager
        focus_item = ""
        for index, record in enumerate(records[: pager.visible_count]):
            item_id = f"{kind.value}-{index}-{record.row_number}"
            tags = ()
            if (
                self.current_result is not None
                and self.current_result.key.kind == kind
                and record.id == self.current_result.key.value
            ):
                tags = ("focus",)
                if not focus_item:
                    focus_item = item_id
            tree.insert("", "end", iid=item_id, values=self._record_values(record), tags=tags)
            self.record_maps[kind][item_id] = record
        tree.tag_configure(
            "focus",
            background=self.colors["accent_soft"],
            foreground=self.colors["accent"],
            font=("Segoe UI Semibold", 10),
        )
        if focus_item:
            tree.see(focus_item)
        self.card_meta[kind].set(f"已显示 {pager.visible_count} / {len(records)}")
        self.load_more_buttons[kind].configure(
            state="normal" if pager.has_more else "disabled"
        )

    def _records_for_kind(
        self,
        kind: QueryKind,
    ) -> tuple[TargetRecord, ...] | tuple[NpcRecord, ...] | tuple[ResourceRecord, ...]:
        if self.current_result is None:
            return ()
        if kind == QueryKind.TARGET:
            return self.current_result.targets
        if kind == QueryKind.NPC:
            return self.current_result.npcs
        return self.current_result.resources

    def _record_values(self, record: Any) -> tuple[Any, ...]:
        if isinstance(record, TargetRecord):
            return (
                record.id,
                self._compact(record.target_type),
                self._compact(record.description),
                "" if record.npc_id is None else record.npc_id,
            )
        if isinstance(record, NpcRecord):
            return (
                record.id,
                self._compact(record.note),
                self._compact(record.name),
                "" if record.resource_id is None else record.resource_id,
            )
        return (
            record.id,
            self._compact(record.configured_path),
        )

    @staticmethod
    def _compact(value: str, limit: int = 140) -> str:
        compact = value.replace("\r", " ").replace("\n", " ↵ ")
        return compact if len(compact) <= limit else f"{compact[: limit - 1]}…"

    def _load_more(self, kind: QueryKind) -> None:
        pager = self.pagers.get(kind)
        if pager is None:
            return
        pager.load_more()
        self._render_card(kind)

    def _on_tree_click(self, event: Any, kind: QueryKind) -> str | None:
        tree = self.result_trees[kind]
        item_id = tree.identify_row(event.y)
        column = tree.identify_column(event.x)
        if not item_id:
            return None
        tree.selection_set(item_id)
        record = self.record_maps[kind].get(item_id)
        self._show_record_detail(record)
        query_key = self._query_key_for_cell(kind, record, column)
        if query_key is not None:
            self.click_arbiter.single(
                lambda key=query_key: self.visit_query(key)
            )
            return "break"
        return None

    def _on_tree_double_click(self, event: Any, kind: QueryKind) -> str | None:
        tree = self.result_trees[kind]
        item_id = tree.identify_row(event.y)
        column = tree.identify_column(event.x)
        record = self.record_maps[kind].get(item_id)
        query_key = self._query_key_for_cell(kind, record, column)
        if query_key is None:
            return None
        label = f"{KIND_TO_QUERY_LABEL[query_key.kind]} {query_key.value}"
        self.click_arbiter.double(
            lambda: self._copy_text(str(query_key.value), label)
        )
        return "break"

    def _on_tree_motion(self, event: Any, kind: QueryKind) -> None:
        tree = self.result_trees[kind]
        item_id = tree.identify_row(event.y)
        record = self.record_maps[kind].get(item_id)
        key = self._query_key_for_cell(kind, record, tree.identify_column(event.x))
        tree.configure(cursor="hand2" if key is not None else "")

    @staticmethod
    def _query_key_for_cell(
        kind: QueryKind,
        record: Any,
        column: str,
    ) -> QueryKey | None:
        if record is None:
            return None
        if kind == QueryKind.TARGET:
            if column == "#1":
                return QueryKey(QueryKind.TARGET, record.id)
            if column == "#4" and record.npc_id is not None and record.npc_id > 0:
                return QueryKey(QueryKind.NPC, record.npc_id)
        elif kind == QueryKind.NPC:
            if column == "#1":
                return QueryKey(QueryKind.NPC, record.id)
            if column == "#4" and record.resource_id is not None and record.resource_id > 0:
                return QueryKey(QueryKind.RESOURCE, record.resource_id)
        elif kind == QueryKind.RESOURCE and column == "#1":
            return QueryKey(QueryKind.RESOURCE, record.id)
        return None

    def _show_selected_detail(self, kind: QueryKind) -> None:
        tree = self.result_trees[kind]
        selected = tree.selection()
        if selected:
            self._show_record_detail(self.record_maps[kind].get(selected[0]))

    def _show_record_detail(self, record: Any) -> None:
        self.selected_record = record
        self.resource_detail_frame.pack_forget()
        self.target_detail_frame.pack_forget()
        self.resource_path_text.set("")
        self.target_position_text.set("")
        self.target_rotation_text.set("")
        if isinstance(record, TargetRecord):
            text = (
                f"目标物 ID：{record.id}  |  类型：{record.target_type or '未填写'}  |  "
                f"NPC ID：{record.npc_id if record.npc_id is not None else '未填写'}  |  "
                f"CSV 行：{record.row_number}\n描述：{record.description or '未填写'}"
            )
            self.target_position_text.set(record.position)
            self.target_rotation_text.set(record.rotation)
            self.target_detail_frame.pack(fill=X, pady=(6, 0))
        elif isinstance(record, NpcRecord):
            text = (
                f"NPC ID：{record.id}  |  名称：{record.name or '未填写'}  |  "
                f"资源 ID：{record.resource_id if record.resource_id is not None else '未填写'}  |  "
                f"CSV 行：{record.row_number}\n备注：{record.note or '未填写'}"
            )
        elif isinstance(record, ResourceRecord):
            text = (
                f"资源 ID：{record.id}  |  CSV 行：{record.row_number}"
            )
            self.resource_path_text.set(record.configured_path)
            self.resource_detail_frame.pack(fill=X, pady=(6, 0))
        else:
            text = "选择任意结果行可查看完整信息"
        self.detail_text.set(text)
        self._update_character_action(record)

    def _update_character_action(self, record: Any) -> None:
        self.character_detail_button.pack_forget()
        self.selected_character_profile = None
        if (
            not isinstance(record, NpcRecord)
            or not record.name.strip()
            or self.character_service is None
        ):
            return
        profile = self.character_service.profile_for_npc(record.id)
        if profile is None:
            return
        self.selected_character_profile = profile
        self.character_detail_button.pack(side=RIGHT)

    def _open_character_detail(self) -> None:
        profile = self.selected_character_profile
        service = self.character_service
        if profile is None or service is None:
            return
        if (
            self.character_window is not None
            and self.character_window.exists()
            and self.character_window.profile.record_id == profile.record_id
        ):
            self.character_window.focus()
            return
        if self.character_window is not None and self.character_window.exists():
            self.character_window.close()
        window = CharacterDetailWindow(
            self.root,
            profile,
            self.colors,
            on_close=self._character_window_closed,
        )
        self.character_window = window
        content_repository = self.character_content_repository
        if content_repository is None:
            window.set_error(
                self.character_content_error
                or "请确认 doc\\csvdir 中存在对话表、开始节点和任务表"
            )
            return
        try:
            details = content_repository.details_for_character(
                profile.record_id,
                service.npc_ids_for_character(profile.record_id),
            )
        except Exception as exc:
            window.set_error(str(exc))
            return
        window.set_details(details)

    def _character_window_closed(self) -> None:
        self.character_window = None

    def _copy_text(self, value: str, label: str) -> None:
        if not value:
            self._set_message(f"{label}没有可复制内容", "warning")
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(value)
        self._show_toast(f"已复制 {label}")

    def _show_toast(self, message: str) -> None:
        self.toast_text.set(message)
        if self.toast_label is None or not self.toast_label.winfo_exists():
            self.toast_label = ttk.Label(
                self.root,
                textvariable=self.toast_text,
                style="Toast.TLabel",
                padding=(12, 7),
            )
        self.toast_label.place(
            relx=1.0,
            rely=1.0,
            x=-18,
            y=-18,
            anchor="se",
        )
        if self.toast_job is not None:
            self.root.after_cancel(self.toast_job)
        self.toast_job = self.root.after(1500, self._hide_toast)

    def _hide_toast(self) -> None:
        self.toast_job = None
        if self.toast_label is not None and self.toast_label.winfo_exists():
            self.toast_label.place_forget()

    def _set_message(self, text: str, level: str) -> None:
        self.message_text.set(text)
        style = {
            "error": "MessageError.TLabel",
            "warning": "MessageWarn.TLabel",
        }.get(level, "Message.TLabel")
        self.message_label.configure(style=style)

    def _update_back_button(self) -> None:
        self.back_button.configure(state="normal" if self.history.can_go_back else "disabled")

    @staticmethod
    def _should_use_dark_theme() -> bool:
        hour = datetime.now().hour
        return hour >= 19 or hour < 6

    def _apply_theme(self, *, force: bool = False) -> None:
        theme = "dark" if self._should_use_dark_theme() else "light"
        if not force and theme == self.current_theme:
            return
        self.current_theme = theme
        self.colors = configure_styles(self.root, self.style, theme == "dark")
        for tree in self.result_trees.values():
            tree.tag_configure(
                "focus",
                background=self.colors["accent_soft"],
                foreground=self.colors["accent"],
                font=("Segoe UI Semibold", 10),
            )

    def _theme_tick(self) -> None:
        self._apply_theme()
        self.root.after(60_000, self._theme_tick)

    def _dpi_tick(self) -> None:
        dpi = get_window_dpi(self.root)
        if dpi > 0 and dpi != self.current_dpi:
            self.current_dpi = dpi
            self.root.tk.call("tk", "scaling", dpi / 72.0)
            self._apply_theme(force=True)
        self.root.after(1000, self._dpi_tick)
