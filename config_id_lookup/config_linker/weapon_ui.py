from pathlib import Path
import threading
from tkinter import BOTH, END, LEFT, RIGHT, X, Y, Canvas, StringVar, Text, ttk
from typing import Callable

from PIL import Image, ImageOps, ImageTk

from .character_visuals import HoverTooltip
from .weapon_icon_catalog import WeaponIconCatalogService
from .weapon_models import (
    WeaponDetails,
    WeaponRecord,
    WeaponSearchResult,
)
from .weapon_query_service import WeaponNotFoundError, WeaponQueryService
from .weapon_repository import WeaponDataError, WeaponRepository


RESULT_LIMIT = 500
RELATION_KEYS = ("same_group", "same_career", "same_model")
RELATION_TITLES = {
    "same_group": "同类武器",
    "same_career": "同职业系列",
    "same_model": "同模型装备",
}


class WeaponIconView(Canvas):
    def __init__(
        self,
        parent,
        colors: dict[str, str],
        *,
        size: int = 68,
    ) -> None:
        super().__init__(
            parent,
            width=size,
            height=size,
            background=colors["tree"],
            borderwidth=0,
            highlightthickness=1,
            highlightbackground=colors["border"],
        )
        self.colors = colors
        self.size = size
        self.icon_id: int | None = None
        self.image_path: Path | None = None
        self._photo: ImageTk.PhotoImage | None = None
        self.tooltip = HoverTooltip(self, colors)
        self._render()

    def set_icon(self, icon_id: int | None, image_path: Path | None) -> None:
        self.icon_id = icon_id
        self.image_path = image_path
        self.tooltip.set_text(
            f"武器图标 ID：{icon_id}" if icon_id is not None else ""
        )
        self._render()

    def set_colors(self, colors: dict[str, str]) -> None:
        self.colors = colors
        self.configure(
            background=colors["tree"],
            highlightbackground=colors["border"],
        )
        self.tooltip.set_colors(colors)
        self._render()

    def _render(self) -> None:
        self.delete("all")
        self._photo = None
        if self.image_path is not None and self.image_path.is_file():
            try:
                with Image.open(self.image_path) as source:
                    image = ImageOps.contain(
                        source.convert("RGBA"),
                        (self.size - 8, self.size - 8),
                        Image.Resampling.LANCZOS,
                    )
                self._photo = ImageTk.PhotoImage(image)
                self.create_image(
                    self.size // 2,
                    self.size // 2,
                    image=self._photo,
                )
                return
            except (OSError, ValueError):
                pass
        self.create_text(
            self.size // 2,
            self.size // 2,
            text=str(self.icon_id or "—"),
            fill=self.colors["muted"],
            font=("Segoe UI", 8),
            width=self.size - 8,
        )


class WeaponLookupFrame(ttk.Frame):
    def __init__(
        self,
        master,
        *,
        copy_text: Callable[[str, str], None] | None = None,
        on_status_changed: Callable[[str, str], None] | None = None,
        colors: dict[str, str] | None = None,
        icon_service: WeaponIconCatalogService | None = None,
    ) -> None:
        super().__init__(master, style="App.TFrame")
        self.copy_text = copy_text
        self.on_status_changed = on_status_changed
        self.colors = colors or {
            "card": "#FFFFFF",
            "tree": "#FBFCFE",
            "text": "#172033",
            "muted": "#667085",
            "border": "#D8E0EA",
            "accent": "#0078D4",
            "accent_soft": "#E8F3FC",
        }
        self.icon_service = icon_service
        self.icon_index_refreshing = False
        self.icon_loading_ids: set[int] = set()
        self.icon_error = ""
        self.doc_directory: Path | None = None
        self.repository: WeaponRepository | None = None
        self.query_service: WeaponQueryService | None = None
        self.current_result: WeaponSearchResult | None = None
        self.current_details: WeaponDetails | None = None
        self.last_error = ""

        self.query_text = StringVar(value="")
        self.status_text = StringVar(value="等待加载武器数据")
        self.status_style = "StatusWarn.TLabel"
        self.message_text = StringVar(value="输入武器名称、装备 ID、转换组 ID 或模型 ID")
        self.selected_name_text = StringVar(value="尚未选择武器")
        self.selected_id_text = StringVar(value="")
        self.selected_meta_text = StringVar(value="查询后选择一条武器记录")
        self.selected_note_text = StringVar(value="")
        self.selected_description_text = StringVar(value="暂无简介")
        self.model_name_text = StringVar(value="")
        self.detail_warning_text = StringVar(value="")

        self.result_records: dict[str, WeaponRecord] = {}
        self.relation_trees: dict[str, ttk.Treeview] = {}
        self.relation_records: dict[str, dict[str, WeaponRecord]] = {}
        self.relation_buttons: dict[int, ttk.Button] = {}
        self.relation_button_texts: dict[str, StringVar] = {}

        self._build_ui()

    def _build_ui(self) -> None:
        status_row = ttk.Frame(self, style="App.TFrame")
        status_row.pack(fill=X, pady=(4, 7))
        self.message_label = ttk.Label(
            status_row,
            textvariable=self.message_text,
            style="Message.TLabel",
        )
        self.message_label.pack(side=LEFT)
        workspace = ttk.Frame(self, style="App.TFrame")
        workspace.pack(fill=BOTH, expand=True)
        workspace.grid_columnconfigure(0, weight=4, uniform="weapon-workspace")
        workspace.grid_columnconfigure(1, weight=6, uniform="weapon-workspace")
        workspace.grid_rowconfigure(0, weight=1)

        left_area = ttk.Frame(workspace, style="App.TFrame")
        left_area.grid(row=0, column=0, sticky="nsew", padx=(0, 5))
        left_area.grid_columnconfigure(0, weight=1)
        left_area.grid_rowconfigure(0, weight=0, minsize=130)
        left_area.grid_rowconfigure(1, weight=1, minsize=0)

        result_border = ttk.Frame(
            left_area,
            style="CardBorder.TFrame",
            padding=1,
        )
        result_border.grid(row=0, column=0, sticky="nsew", pady=(0, 5))
        result_card = ttk.Frame(result_border, style="Card.TFrame", padding=(11, 9))
        result_card.pack(fill=BOTH, expand=True)
        result_header = ttk.Frame(result_card, style="Card.TFrame")
        result_header.pack(fill=X, pady=(0, 7))
        ttk.Label(
            result_header,
            text="查询命中",
            style="Section.TLabel",
        ).pack(side=LEFT)

        result_columns = ("id", "name", "career", "group")
        self.result_tree = ttk.Treeview(
            result_card,
            columns=result_columns,
            show="headings",
            style="Result.Treeview",
            selectmode="browse",
            height=3,
        )
        headings = (
            ("id", "装备 ID", 82),
            ("name", "武器名称", 170),
            ("career", "职业", 92),
            ("group", "转换组", 92),
        )
        for key, text, width in headings:
            self.result_tree.heading(key, text=text)
            self.result_tree.column(
                key,
                width=width,
                minwidth=60,
                stretch=key in {"name", "career", "group"},
            )
        result_scroll = ttk.Scrollbar(
            result_card,
            orient="vertical",
            command=self.result_tree.yview,
        )
        result_xscroll = ttk.Scrollbar(
            result_card,
            orient="horizontal",
            command=self.result_tree.xview,
        )
        self.result_tree.configure(
            yscrollcommand=result_scroll.set,
            xscrollcommand=result_xscroll.set,
        )
        result_xscroll.pack(side="bottom", fill=X)
        result_scroll.pack(side=RIGHT, fill=Y)
        self.result_tree.pack(side=LEFT, fill=BOTH, expand=True)
        self.result_tree.bind(
            "<<TreeviewSelect>>",
            lambda _event: self._show_result_selection(),
        )
        self.result_tree.bind(
            "<Double-1>",
            lambda event: self._copy_tree_weapon_id(
                event,
                self.result_tree,
                self.result_records,
            ),
        )

        detail_card = ttk.Frame(
            left_area,
            style="Card.TFrame",
            padding=(13, 10),
        )
        detail_card.grid(row=1, column=0, sticky="nsew", pady=(5, 0))
        detail_summary = ttk.Frame(detail_card, style="Card.TFrame")
        detail_summary.pack(fill=X)
        self.weapon_icon_view = WeaponIconView(
            detail_summary,
            self.colors,
        )
        self.weapon_icon_view.pack(side=LEFT, padx=(0, 10))
        detail_info = ttk.Frame(detail_summary, style="Card.TFrame")
        detail_info.pack(side=LEFT, fill=X, expand=True)
        detail_header = ttk.Frame(detail_info, style="Card.TFrame")
        detail_header.pack(fill=X)
        ttk.Label(
            detail_header,
            textvariable=self.selected_name_text,
            style="DetailName.TLabel",
        ).pack(side=LEFT)
        ttk.Label(
            detail_header,
            textvariable=self.selected_id_text,
            style="FocusBadge.TLabel",
        ).pack(side=RIGHT)
        ttk.Label(
            detail_info,
            textvariable=self.selected_meta_text,
            style="Muted.TLabel",
            justify="left",
        ).pack(fill=X, anchor="w", pady=(5, 0))
        ttk.Label(
            detail_info,
            textvariable=self.selected_note_text,
            style="Muted.TLabel",
            justify="left",
        ).pack(fill=X, anchor="w", pady=(2, 0))
        ttk.Label(
            detail_card,
            text="简介",
            style="ProfileSectionCard.TLabel",
        ).pack(fill=X, anchor="w", pady=(8, 0))
        self.description_text = Text(
            detail_card,
            height=4,
            wrap="word",
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            font=("Segoe UI", 9),
            padx=6,
            pady=5,
        )
        self.description_text.pack(fill=BOTH, expand=True, pady=(2, 0))
        self.description_text.bind("<Control-a>", self._select_description_all)
        self.set_colors(self.colors)
        self._set_description("暂无简介")

        path_row = ttk.Frame(detail_card, style="Card.TFrame")
        path_row.pack(fill=X, pady=(7, 0))
        ttk.Label(path_row, text="模型名称", style="Muted.TLabel").pack(
            side=LEFT,
            padx=(0, 8),
        )
        self.model_name_entry = ttk.Entry(
            path_row,
            textvariable=self.model_name_text,
            state="readonly",
        )
        self.model_name_entry.pack(side=LEFT, fill=X, expand=True)
        self.model_name_entry.bind(
            "<Double-1>",
            lambda _event: self._copy_value(
                self.model_name_text.get(),
                "武器模型名称",
            ),
        )
        self.detail_warning_label = ttk.Label(
            detail_card,
            textvariable=self.detail_warning_text,
            style="MessageWarn.TLabel",
            justify="left",
        )
        self.detail_warning_label.pack(fill=X, anchor="w", pady=(5, 0))

        relation_area = ttk.Frame(workspace, style="App.TFrame")
        relation_area.grid(row=0, column=1, sticky="nsew", padx=(5, 0))
        relation_area.grid_columnconfigure(0, weight=1)
        relation_area.grid_rowconfigure(1, weight=1)
        relation_header = ttk.Frame(relation_area, style="App.TFrame")
        relation_header.grid(row=0, column=0, sticky="ew", pady=(0, 5))
        ttk.Label(
            relation_header,
            text="关联武器",
            style="AppSection.TLabel",
        ).pack(side=LEFT)
        relation_navigation = ttk.Frame(
            relation_header,
            style="App.TFrame",
        )
        relation_navigation.pack(side=RIGHT)
        for index, key in enumerate(RELATION_KEYS):
            text = StringVar(value=f"{RELATION_TITLES[key]} 0")
            button = ttk.Button(
                relation_navigation,
                textvariable=text,
                width=13,
                command=lambda tab_index=index: self._select_relation(
                    tab_index
                ),
            )
            button.pack(side=LEFT, padx=(4, 0))
            self.relation_button_texts[key] = text
            self.relation_buttons[index] = button

        self.relation_tabs = ttk.Notebook(
            relation_area,
            style="Workspace.TNotebook",
        )
        self.relation_tabs.grid(row=1, column=0, sticky="nsew")

        for key in RELATION_KEYS:
            page = ttk.Frame(
                self.relation_tabs,
                style="Card.TFrame",
                padding=(8, 7),
            )
            self.relation_tabs.add(page, text=RELATION_TITLES[key])
            page.pack_propagate(False)
            tree = self._build_relation_tree(page)
            records: dict[str, WeaponRecord] = {}
            tree.bind(
                "<<TreeviewSelect>>",
                lambda _event, current_tree=tree, current_records=records:
                self._show_relation_selection(current_tree, current_records),
            )
            tree.bind(
                "<Double-1>",
                lambda event, current_tree=tree, current_records=records:
                self._copy_tree_weapon_id(event, current_tree, current_records),
            )
            self.relation_trees[key] = tree
            self.relation_records[key] = records
        self.relation_tabs.bind(
            "<<NotebookTabChanged>>",
            lambda _event: self._refresh_relation_buttons(),
        )
        self._refresh_relation_buttons()

    def build_query_controls(self, parent: ttk.Frame) -> None:
        self.query_entry = ttk.Entry(
            parent,
            textvariable=self.query_text,
            width=28,
        )
        self.query_entry.pack(side=LEFT, fill=X, expand=True)
        self.query_entry.bind("<Return>", lambda _event: self.search())
        ttk.Button(
            parent,
            text="搜索",
            style="Accent.TButton",
            command=self.search,
        ).pack(side=LEFT, padx=(7, 0))

    def _select_relation(self, index: int) -> None:
        self.relation_tabs.select(index)
        self._refresh_relation_buttons()

    def _refresh_relation_buttons(self) -> None:
        selected = self.relation_tabs.select()
        tabs = self.relation_tabs.tabs()
        for index, button in self.relation_buttons.items():
            button.configure(
                style=(
                    "SegmentActive.TButton"
                    if index < len(tabs) and tabs[index] == selected
                    else "Segment.TButton"
                )
            )

    @staticmethod
    def _build_relation_tree(parent: ttk.Frame) -> ttk.Treeview:
        columns = ("id", "name", "career", "group", "model")
        tree = ttk.Treeview(
            parent,
            columns=columns,
            show="headings",
            style="Result.Treeview",
            selectmode="browse",
            height=9,
        )
        headings = (
            ("id", "装备 ID", 84),
            ("name", "武器名称", 210),
            ("career", "职业", 92),
            ("group", "转换组", 96),
            ("model", "模型 ID", 82),
        )
        for key, text, width in headings:
            tree.heading(key, text=text)
            tree.column(
                key,
                width=width,
                minwidth=60,
                stretch=key in {"name", "career", "group"},
            )
        scrollbar = ttk.Scrollbar(parent, orient="vertical", command=tree.yview)
        xscrollbar = ttk.Scrollbar(
            parent,
            orient="horizontal",
            command=tree.xview,
        )
        tree.configure(
            yscrollcommand=scrollbar.set,
            xscrollcommand=xscrollbar.set,
        )
        xscrollbar.pack(side="bottom", fill=X)
        scrollbar.pack(side=RIGHT, fill=Y)
        tree.pack(side=LEFT, fill=BOTH, expand=True)
        return tree

    def load(self, doc_directory: Path) -> bool:
        self.doc_directory = Path(doc_directory)
        self._set_status(
            "正在加载正式服武器数据...",
            "StatusWarn.TLabel",
        )
        self.update_idletasks()
        try:
            repository = WeaponRepository.load(self.doc_directory)
        except (OSError, UnicodeError, WeaponDataError) as exc:
            self.last_error = str(exc)
            if self.repository is None:
                status = "武器数据加载失败"
            else:
                status = "武器刷新失败，仍使用旧数据"
            self._set_status(status, "StatusError.TLabel")
            self._set_message(f"武器数据加载失败：{exc}", "error")
            return False

        self.repository = repository
        self.query_service = WeaponQueryService(repository)
        self.last_error = ""
        report = repository.report
        self._set_status(
            f"武器 {report.weapon_count} · 转换组 {report.group_count}",
            "StatusGood.TLabel",
        )
        if self.current_result is not None:
            self.search()
        elif report.warnings:
            self._set_message("；".join(report.warnings), "warning")
        else:
            self._set_message(
                "正式服武器数据加载成功",
                "normal",
            )
        if (
            self.icon_service is not None
            and not self.icon_service.index_is_fresh()
        ):
            self.refresh_icon_index_async()
        return True

    def search(self) -> None:
        query = self.query_text.get().strip()
        if not query:
            self._set_message("请输入武器名称或 ID", "error")
            return
        if self.query_service is None:
            self._set_message("武器数据尚未加载，请先重新加载", "error")
            return
        try:
            result = self.query_service.search(query)
        except (ValueError, WeaponNotFoundError) as exc:
            self._clear_results()
            self._set_message(str(exc), "error")
            return

        self.current_result = result
        self._render_search_result(result)
        kind_text = "、".join(result.match_kinds)
        shown_count = min(len(result.weapons), RESULT_LIMIT)
        message = (
            f"按{kind_text}命中 {len(result.weapons)} 把武器"
            if kind_text
            else f"命中 {len(result.weapons)} 把武器"
        )
        if shown_count < len(result.weapons):
            message += f"，当前显示前 {shown_count} 条"
        if result.warnings:
            message += "；" + "；".join(result.warnings)
            self._set_message(message, "warning")
        else:
            self._set_message(message, "normal")

    def _render_search_result(self, result: WeaponSearchResult) -> None:
        self._clear_tree(self.result_tree)
        self.result_records.clear()
        for index, weapon in enumerate(result.weapons[:RESULT_LIMIT]):
            item_id = f"weapon-{index}-{weapon.id}-{weapon.row_number}"
            self.result_tree.insert(
                "",
                "end",
                iid=item_id,
                values=self._result_weapon_values(weapon),
            )
            self.result_records[item_id] = weapon
        items = self.result_tree.get_children()
        if items:
            self.result_tree.selection_set(items[0])
            self.result_tree.focus(items[0])
            self.result_tree.see(items[0])
            self._show_weapon_details(self.result_records[items[0]])

    def _show_result_selection(self) -> None:
        selection = self.result_tree.selection()
        if not selection:
            return
        weapon = self.result_records.get(selection[0])
        if weapon is not None:
            self._show_weapon_details(weapon)

    def _show_relation_selection(
        self,
        tree: ttk.Treeview,
        records: dict[str, WeaponRecord],
    ) -> None:
        selection = tree.selection()
        if not selection:
            return
        weapon = records.get(selection[0])
        if weapon is not None:
            self._show_weapon_details(weapon)

    def _show_weapon_details(self, weapon: WeaponRecord) -> None:
        if self.query_service is None:
            return
        details = self.query_service.details(weapon)
        self.current_details = details
        career_text = self._career_text(weapon)
        group_text = self._group_text(weapon)
        model_text = str(weapon.model_id) if weapon.model_id else "未配置"
        level_parts = []
        if weapon.equipment_level is not None:
            level_parts.append(f"装备等级 {weapon.equipment_level}")
        if weapon.wear_level is not None:
            level_parts.append(f"穿戴等级 {weapon.wear_level}")
        level_text = " · ".join(level_parts) if level_parts else "等级未配置"

        self.selected_name_text.set(weapon.name or "未命名武器")
        self.selected_id_text.set(f"装备 ID {weapon.id}")
        self.selected_meta_text.set(
            f"职业：{career_text}    转换组：{group_text}\n"
            f"部位：{weapon.part_name or weapon.part_id or '未配置'}    "
            f"模型 ID：{model_text}    图标 ID：{weapon.icon_id or '未配置'}    "
            f"{level_text}"
        )
        appearance_notes = "、".join(
            appearance.note
            for appearance in details.appearances
            if appearance.note
        )
        note_parts = [part for part in (weapon.note, appearance_notes) if part]
        self.selected_note_text.set(
            "备注：" + " · ".join(note_parts) if note_parts else ""
        )
        self._set_description(weapon.description or "暂无简介")
        self.model_name_text.set(
            self._model_names(details)
        )
        self.detail_warning_text.set("；".join(details.warnings))
        self._show_weapon_icon(weapon)
        self._render_relations(details)

    def refresh_icon_index_async(self) -> None:
        if self.icon_service is None or self.icon_index_refreshing:
            return
        self.icon_index_refreshing = True
        threading.Thread(
            target=self._refresh_icon_index_worker,
            daemon=True,
        ).start()

    def _refresh_icon_index_worker(self) -> None:
        if self.icon_service is None:
            return
        try:
            self.icon_service.refresh_index()
        except Exception as exc:
            self.after(
                0,
                lambda error=exc: self._icon_index_failed(error),
            )
            return
        self.after(0, self._icon_index_ready)

    def _icon_index_ready(self) -> None:
        self.icon_index_refreshing = False
        self.icon_error = ""
        if self.current_details is not None:
            self._show_weapon_icon(self.current_details.weapon)

    def _icon_index_failed(self, error: Exception) -> None:
        self.icon_index_refreshing = False
        self.icon_error = str(error)
        self._set_message(
            f"在线武器图标暂不可用：{error}；本地武器查询不受影响",
            "warning",
        )

    def _show_weapon_icon(self, weapon: WeaponRecord) -> None:
        icon_id = weapon.icon_id
        service = self.icon_service
        if icon_id is None or service is None:
            self.weapon_icon_view.set_icon(icon_id, None)
            return
        asset = service.asset_for_icon(icon_id)
        path = service.asset_path(asset)
        if path is not None and path.is_file():
            self.weapon_icon_view.set_icon(icon_id, path)
            return
        self.weapon_icon_view.set_icon(icon_id, None)
        if asset is None or icon_id in self.icon_loading_ids:
            return
        self.icon_loading_ids.add(icon_id)
        threading.Thread(
            target=self._load_weapon_icon_worker,
            args=(icon_id,),
            daemon=True,
        ).start()

    def _load_weapon_icon_worker(self, icon_id: int) -> None:
        if self.icon_service is None:
            return
        try:
            path = self.icon_service.ensure_icon(icon_id)
        except Exception as exc:
            self.after(
                0,
                lambda error=exc: self._weapon_icon_failed(
                    icon_id,
                    error,
                ),
            )
            return
        self.after(
            0,
            lambda: self._weapon_icon_ready(icon_id, path),
        )

    def _weapon_icon_ready(
        self,
        icon_id: int,
        path: Path | None,
    ) -> None:
        self.icon_loading_ids.discard(icon_id)
        if (
            self.current_details is not None
            and self.current_details.weapon.icon_id == icon_id
        ):
            self.weapon_icon_view.set_icon(icon_id, path)

    def _weapon_icon_failed(
        self,
        icon_id: int,
        error: Exception,
    ) -> None:
        self.icon_loading_ids.discard(icon_id)
        self.icon_error = str(error)

    def _render_relations(self, details: WeaponDetails) -> None:
        relation_values = {
            "same_group": details.same_group_weapons,
            "same_career": details.same_career_weapons,
            "same_model": details.same_model_weapons,
        }
        for index, key in enumerate(RELATION_KEYS):
            tree = self.relation_trees[key]
            records = self.relation_records[key]
            self._clear_tree(tree)
            records.clear()
            weapons = relation_values[key]
            for row_index, weapon in enumerate(weapons[:RESULT_LIMIT]):
                item_id = (
                    f"{key}-{row_index}-{weapon.id}-{weapon.row_number}"
                )
                tree.insert(
                    "",
                    "end",
                    iid=item_id,
                    values=self._weapon_values(weapon),
                )
                records[item_id] = weapon
            self.relation_button_texts[key].set(
                f"{RELATION_TITLES[key]} {len(weapons)}"
            )

    def _weapon_values(self, weapon: WeaponRecord) -> tuple[object, ...]:
        return (
            weapon.id,
            weapon.name,
            self._career_text(weapon),
            self._group_text(weapon),
            weapon.model_id or "",
        )

    def _result_weapon_values(
        self,
        weapon: WeaponRecord,
    ) -> tuple[object, ...]:
        return self._weapon_values(weapon)[:4]

    def _career_text(self, weapon: WeaponRecord) -> str:
        if self.repository is None:
            return "、".join(str(value) for value in weapon.career_ids)
        names = [
            career.name
            for career_id in weapon.career_ids
            for career in self.repository.careers_by_id.get(career_id, [])
            if career.name
        ]
        return "、".join(names) or weapon.career_text or "未配置"

    def _group_text(self, weapon: WeaponRecord) -> str:
        if self.repository is None:
            return "未分组"
        groups = self.repository.groups_by_equipment_id.get(weapon.id, [])
        return "、".join(group.name or str(group.id) for group in groups) or "未分组"

    @staticmethod
    def _model_names(details: WeaponDetails) -> str:
        names: list[str] = []
        for appearance in details.appearances:
            for raw_path in appearance.path.split(";"):
                path = raw_path.strip()
                if not path:
                    continue
                name = (
                    path.rsplit(".", 1)[-1]
                    if "." in path
                    else path.rsplit("/", 1)[-1]
                )
                if name and name not in names:
                    names.append(name)
        return "；".join(names)

    def _copy_tree_weapon_id(
        self,
        event,
        tree: ttk.Treeview,
        records: dict[str, WeaponRecord],
    ) -> str:
        item_id = tree.identify_row(event.y)
        weapon = records.get(item_id)
        if weapon is not None:
            self._copy_value(str(weapon.id), f"武器装备 ID {weapon.id}")
        return "break"

    def _copy_value(self, value: str, label: str) -> None:
        if self.copy_text is not None:
            self.copy_text(value, label)

    def _set_description(self, value: str) -> None:
        self.selected_description_text.set(value)
        self.description_text.configure(state="normal")
        self.description_text.delete("1.0", END)
        self.description_text.insert("1.0", value)
        self.description_text.configure(state="disabled")

    def _select_description_all(self, _event) -> str:
        self.description_text.tag_add("sel", "1.0", "end-1c")
        return "break"

    def set_colors(self, colors: dict[str, str]) -> None:
        self.colors = colors
        if not hasattr(self, "description_text"):
            return
        self.description_text.configure(
            background=colors["tree"],
            foreground=colors["text"],
            insertbackground=colors["text"],
            highlightbackground=colors["border"],
            highlightcolor=colors["border"],
            selectbackground=colors["accent_soft"],
            selectforeground=colors["text"],
        )
        if hasattr(self, "weapon_icon_view"):
            self.weapon_icon_view.set_colors(colors)

    def _set_status(self, text: str, style: str) -> None:
        self.status_text.set(text)
        self.status_style = style
        if self.on_status_changed is not None:
            self.on_status_changed(text, style)

    def _clear_results(self) -> None:
        self.current_result = None
        self.current_details = None
        self._clear_tree(self.result_tree)
        self.result_records.clear()
        self.selected_name_text.set("尚未选择武器")
        self.selected_id_text.set("")
        self.selected_meta_text.set("查询后选择一条武器记录")
        self.selected_note_text.set("")
        self._set_description("暂无简介")
        self.model_name_text.set("")
        self.detail_warning_text.set("")
        self.weapon_icon_view.set_icon(None, None)
        for index, key in enumerate(RELATION_KEYS):
            self._clear_tree(self.relation_trees[key])
            self.relation_records[key].clear()
            self.relation_button_texts[key].set(
                f"{RELATION_TITLES[key]} 0"
            )

    @staticmethod
    def _clear_tree(tree: ttk.Treeview) -> None:
        children = tree.get_children()
        if children:
            tree.delete(*children)

    def _set_message(self, text: str, level: str) -> None:
        self.message_text.set(text)
        self.message_label.configure(
            style={
                "error": "MessageError.TLabel",
                "warning": "MessageWarn.TLabel",
            }.get(level, "Message.TLabel")
        )
