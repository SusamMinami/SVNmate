from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import datetime
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, X, Y, StringVar, Text, Toplevel, ttk
from typing import Any

from .character_catalog import (
    CharacterDetails,
    CharacterDialogue,
    CharacterProfile,
    CharacterStory,
    CharacterTask,
    CharacterVisuals,
)
from .character_visuals import CharacterPortraitBanner


TAB_TASKS = "tasks"
TAB_DIALOGUES = "dialogues"
TAB_STORIES = "stories"


class CharacterDetailWindow:
    def __init__(
        self,
        parent: Any,
        profile: CharacterProfile,
        colors: dict[str, str],
        *,
        visuals: CharacterVisuals | None = None,
        portrait_path: Path | None = None,
        on_close: Callable[[], None] | None = None,
    ) -> None:
        self.parent = parent
        self.profile = profile
        self.colors = colors
        self.on_close = on_close
        self.details: CharacterDetails | None = None
        self.current_tab = TAB_TASKS
        self.item_records: dict[str, Any] = {}
        self.visuals = visuals or CharacterVisuals()
        self.portrait_path = portrait_path

        self.window = Toplevel(parent)
        self.window.title(f"{profile.name} · 角色档案")
        self.window.configure(bg=colors["bg"])
        self.window.minsize(880, 620)
        self._set_geometry()
        self.window.protocol("WM_DELETE_WINDOW", self.close)

        self.search_text = StringVar()
        self.status_text = StringVar(value="正在准备角色资料...")
        self.tab_buttons: dict[str, ttk.Button] = {}
        self._build()
        self._render_profile()
        self._select_tab(TAB_TASKS)
        self.search_text.trace_add("write", lambda *_args: self._render_list())

    def _set_geometry(self) -> None:
        self.parent.update_idletasks()
        width = min(1120, max(880, self.parent.winfo_screenwidth() - 100))
        height = min(780, max(620, self.parent.winfo_screenheight() - 120))
        parent_x = self.parent.winfo_rootx()
        parent_y = self.parent.winfo_rooty()
        parent_width = max(self.parent.winfo_width(), width)
        parent_height = max(self.parent.winfo_height(), height)
        x = max(0, parent_x + (parent_width - width) // 2)
        y = max(0, parent_y + (parent_height - height) // 2)
        self.window.geometry(f"{width}x{height}+{x}+{y}")

    def _build(self) -> None:
        main = ttk.Frame(
            self.window,
            style="App.TFrame",
            padding=(22, 18, 22, 16),
        )
        main.pack(fill=BOTH, expand=True)

        self.portrait_banner = CharacterPortraitBanner(
            main,
            self.colors,
            name=self.profile.name,
        )
        self.portrait_banner.pack(fill=X)
        self.portrait_banner.set_visual(
            self.visuals.portrait,
            self.portrait_path,
        )

        self.tags_frame = ttk.Frame(main, style="App.TFrame")
        self.tags_frame.pack(fill=X, pady=(8, 10))

        self.summary_section = ttk.Frame(main, style="App.TFrame")
        self.summary_section.pack(fill=X)
        ttk.Label(
            self.summary_section,
            text="设定摘要",
            style="ProfileSection.TLabel",
        ).pack(anchor="w")
        self.summary_text = self._make_text(
            self.summary_section,
            height=3,
            background=self.colors["bg"],
        )
        self.summary_text.pack(fill=X, pady=(3, 9))

        analysis_row = ttk.Frame(main, style="App.TFrame")
        analysis_row.pack(fill=X, pady=(0, 12))
        analysis_row.grid_columnconfigure(0, weight=1, uniform="profile")
        analysis_row.grid_columnconfigure(1, weight=1, uniform="profile")
        self.personality_section = self._build_profile_text_section(
            analysis_row,
            "性格分析",
            0,
        )
        self.story_section = self._build_profile_text_section(
            analysis_row,
            "故事经历",
            1,
        )

        ttk.Separator(main, orient="horizontal").pack(fill=X, pady=(0, 10))

        tab_row = ttk.Frame(main, style="App.TFrame")
        tab_row.pack(fill=X)
        for key, label in (
            (TAB_TASKS, "任务"),
            (TAB_DIALOGUES, "台词"),
            (TAB_STORIES, "剧情"),
        ):
            button = ttk.Button(
                tab_row,
                text=label,
                style="Segment.TButton",
                command=lambda tab=key: self._select_tab(tab),
            )
            button.pack(side=LEFT, padx=(0, 4))
            self.tab_buttons[key] = button

        filter_row = ttk.Frame(main, style="App.TFrame")
        filter_row.pack(fill=X, pady=(9, 8))
        ttk.Label(
            filter_row,
            text="筛选",
            style="AppMuted.TLabel",
        ).pack(side=LEFT, padx=(0, 8))
        self.search_entry = ttk.Entry(
            filter_row,
            textvariable=self.search_text,
        )
        self.search_entry.pack(side=LEFT, fill=X, expand=True)

        content = ttk.Panedwindow(main, orient="horizontal")
        content.pack(fill=BOTH, expand=True)

        list_frame = ttk.Frame(content, style="Card.TFrame", padding=(1, 1))
        detail_frame = ttk.Frame(content, style="Card.TFrame", padding=(12, 10))
        content.add(list_frame, weight=3)
        content.add(detail_frame, weight=2)

        self.tree = ttk.Treeview(
            list_frame,
            show="headings",
            style="Result.Treeview",
            selectmode="browse",
        )
        tree_scrollbar = ttk.Scrollbar(
            list_frame,
            orient="vertical",
            command=self.tree.yview,
        )
        self.tree.configure(yscrollcommand=tree_scrollbar.set)
        self.tree.pack(side=LEFT, fill=BOTH, expand=True)
        tree_scrollbar.pack(side=RIGHT, fill=Y)
        self.tree.bind("<<TreeviewSelect>>", self._show_selected_item)

        ttk.Label(
            detail_frame,
            text="条目详情",
            style="ProfileSectionCard.TLabel",
        ).pack(anchor="w")
        item_detail_frame = ttk.Frame(detail_frame, style="Card.TFrame")
        item_detail_frame.pack(fill=BOTH, expand=True, pady=(5, 0))
        self.item_detail_text = self._make_text(
            item_detail_frame,
            height=14,
            background=self.colors["card"],
        )
        item_detail_scrollbar = ttk.Scrollbar(
            item_detail_frame,
            orient="vertical",
            command=self.item_detail_text.yview,
        )
        self.item_detail_text.configure(
            yscrollcommand=item_detail_scrollbar.set
        )
        self.item_detail_text.pack(side=LEFT, fill=BOTH, expand=True)
        item_detail_scrollbar.pack(side=RIGHT, fill=Y)

        self.status_label = ttk.Label(
            main,
            textvariable=self.status_text,
            style="AppMuted.TLabel",
        )
        self.status_label.pack(fill=X, pady=(8, 0))

    def _build_profile_text_section(
        self,
        parent: ttk.Frame,
        title: str,
        column: int,
    ) -> tuple[ttk.Frame, Text]:
        section = ttk.Frame(parent, style="App.TFrame")
        section.grid(
            row=0,
            column=column,
            sticky="nsew",
            padx=(0, 12) if column == 0 else (12, 0),
        )
        ttk.Label(
            section,
            text=title,
            style="ProfileSection.TLabel",
        ).pack(anchor="w")
        text = self._make_text(
            section,
            height=6,
            background=self.colors["bg"],
        )
        text.pack(fill=X, pady=(3, 0))
        return section, text

    def _make_text(
        self,
        parent: Any,
        *,
        height: int,
        background: str,
    ) -> Text:
        return Text(
            parent,
            height=height,
            width=1,
            wrap="word",
            relief="flat",
            borderwidth=0,
            highlightthickness=0,
            padx=0,
            pady=2,
            background=background,
            foreground=self.colors["text"],
            insertbackground=self.colors["text"],
            selectbackground=self.colors["accent_soft"],
            selectforeground=self.colors["text"],
            font=("Segoe UI", 10),
        )

    def _render_profile(self) -> None:
        self._set_meta(dialogue_count=self.profile.dialogue_count)

        for child in self.tags_frame.winfo_children():
            child.destroy()
        for tag in self.profile.tags:
            ttk.Label(
                self.tags_frame,
                text=tag,
                style="Tag.TLabel",
            ).pack(side=LEFT, padx=(0, 6))

        self._set_text(self.summary_text, self.profile.summary)
        personality_frame, personality_text = self.personality_section
        story_frame, story_text = self.story_section
        self._set_text(personality_text, self.profile.personality)
        self._set_text(story_text, self.profile.story)
        if not self.profile.summary:
            self.summary_section.pack_forget()
        if not self.profile.personality:
            personality_frame.grid_remove()
        if not self.profile.story:
            story_frame.grid_remove()

    def _set_meta(self, *, dialogue_count: int) -> None:
        meta = [
            value
            for value in (
                "命名角色",
                self.profile.evidence_level,
                self.profile.analysis_status,
                f"{dialogue_count} 条台词",
            )
            if value
        ]
        self.portrait_banner.set_meta(" · ".join(meta))

    def set_visuals(
        self,
        visuals: CharacterVisuals,
        portrait_path: Path | None,
    ) -> None:
        self.visuals = visuals
        self.portrait_path = portrait_path
        self.portrait_banner.set_visual(visuals.portrait, portrait_path)

    def set_colors(self, colors: dict[str, str]) -> None:
        self.colors = colors
        self.window.configure(bg=colors["bg"])
        self.portrait_banner.set_colors(colors)

    def set_loading(self, cached: bool = False) -> None:
        del cached
        self.status_text.set("正在读取本地角色内容...")

    def set_error(self, message: str, *, cached: bool = False) -> None:
        del cached
        prefix = "本地角色内容加载失败"
        self.status_text.set(f"{prefix}：{message}")

    def set_details(self, details: CharacterDetails) -> None:
        if details.character_id != self.profile.record_id:
            return
        self.details = details
        self.tab_buttons[TAB_TASKS].configure(
            text=f"任务 {len(details.tasks)}"
        )
        self.tab_buttons[TAB_DIALOGUES].configure(
            text=f"台词 {len(details.dialogues)}"
        )
        self.tab_buttons[TAB_STORIES].configure(
            text=f"剧情 {len(details.stories)}"
        )
        self._set_meta(dialogue_count=len(details.dialogues))
        local_time = details.loaded_at.astimezone()
        self.status_text.set(
            f"本地配置加载于 {local_time:%Y-%m-%d %H:%M}"
        )
        self._render_list()

    def _select_tab(self, tab: str) -> None:
        self.current_tab = tab
        for key, button in self.tab_buttons.items():
            button.configure(
                style=(
                    "SegmentActive.TButton"
                    if key == tab
                    else "Segment.TButton"
                )
            )
        self.search_text.set("")
        self._configure_columns()
        self._render_list()

    def _configure_columns(self) -> None:
        if self.current_tab == TAB_TASKS:
            columns = (
                ("id", "任务 ID", 110),
                ("name", "任务名称", 180),
                ("description", "任务描述", 280),
            )
        elif self.current_tab == TAB_DIALOGUES:
            columns = (
                ("id", "台词 ID", 110),
                ("prefix", "剧情", 76),
                ("content", "台词内容", 300),
            )
        else:
            columns = (
                ("prefix", "剧情任务", 100),
                ("start", "开始节点", 110),
                ("outline", "剧情简介", 280),
            )
        self.tree.configure(columns=tuple(column[0] for column in columns))
        for column_id, heading, width in columns:
            self.tree.heading(column_id, text=heading)
            self.tree.column(
                column_id,
                width=width,
                minwidth=60,
                stretch=column_id in {
                    "description",
                    "content",
                    "outline",
                },
                anchor="w",
            )

    def _records(self) -> tuple[Any, ...]:
        if self.details is None:
            return ()
        if self.current_tab == TAB_TASKS:
            return self.details.tasks
        if self.current_tab == TAB_DIALOGUES:
            return self.details.dialogues
        return self.details.stories

    def _render_list(self) -> None:
        self.tree.delete(*self.tree.get_children())
        self.item_records.clear()
        query = self.search_text.get().strip().casefold()
        visible = [
            record
            for record in self._records()
            if not query or query in self._searchable_text(record).casefold()
        ]
        for index, record in enumerate(visible):
            item_id = f"{self.current_tab}-{index}"
            self.tree.insert(
                "",
                END,
                iid=item_id,
                values=self._values(record),
            )
            self.item_records[item_id] = record
        if visible:
            first = self.tree.get_children()[0]
            self.tree.selection_set(first)
            self.tree.focus(first)
            self.tree.see(first)
            self._show_item_detail(visible[0])
        else:
            self._set_text(
                self.item_detail_text,
                "没有匹配的记录" if query else "暂无记录",
            )

    @staticmethod
    def _compact(value: str, limit: int = 100) -> str:
        compact = value.replace("\r", " ").replace("\n", " ")
        return compact if len(compact) <= limit else f"{compact[: limit - 1]}…"

    def _values(self, record: Any) -> tuple[str, ...]:
        if isinstance(record, CharacterTask):
            return (
                record.task_id,
                record.name,
                self._compact(record.description),
            )
        if isinstance(record, CharacterDialogue):
            return (
                record.dialogue_id,
                record.task_prefix,
                self._compact(record.content),
            )
        return (
            record.task_prefix,
            record.start_node_id,
            self._compact(record.outline),
        )

    @staticmethod
    def _searchable_text(record: Any) -> str:
        if isinstance(record, CharacterTask):
            values: Iterable[str] = (
                record.task_id,
                record.name,
                record.description,
                record.task_type,
            )
        elif isinstance(record, CharacterDialogue):
            values = (
                record.dialogue_id,
                record.task_prefix,
                record.content,
            )
        else:
            values = (
                record.task_prefix,
                record.start_node_id,
                record.outline,
            )
        return "\n".join(values)

    def _show_selected_item(self, _event: Any = None) -> None:
        selection = self.tree.selection()
        if selection:
            self._show_item_detail(self.item_records.get(selection[0]))

    def _show_item_detail(self, record: Any) -> None:
        if isinstance(record, CharacterTask):
            title = record.name or "未命名任务"
            content = (
                f"任务 {record.task_id or '—'}\n"
                f"{title}"
                + f"\n\n{record.description or '暂无任务简介'}"
            )
        elif isinstance(record, CharacterDialogue):
            content = (
                f"台词 {record.dialogue_id or '—'}"
                + (
                    f"\n剧情任务 {record.task_prefix}"
                    if record.task_prefix
                    else ""
                )
                + f"\n\n{record.content or '暂无台词内容'}"
            )
        elif isinstance(record, CharacterStory):
            content = (
                f"剧情任务 {record.task_prefix or '—'}"
                + (
                    f"\n开始节点 {record.start_node_id}"
                    if record.start_node_id
                    else ""
                )
                + f"\n\n{record.outline or '暂无剧情简介'}"
            )
        else:
            content = "暂无记录"
        self._set_text(self.item_detail_text, content)

    @staticmethod
    def _set_text(widget: Text, value: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", END)
        widget.insert("1.0", value)
        widget.configure(state="disabled")

    def focus(self) -> None:
        self.window.deiconify()
        self.window.lift()
        self.window.focus_force()

    def exists(self) -> bool:
        return bool(self.window.winfo_exists())

    def close(self) -> None:
        if self.window.winfo_exists():
            self.window.destroy()
        if self.on_close is not None:
            self.on_close()
