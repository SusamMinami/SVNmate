import ctypes
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timedelta
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, X, Y, BooleanVar, StringVar, Tk, filedialog, messagebox
from tkinter import ttk


if os.name == "nt":
    import winsound
    from ctypes import wintypes


if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).resolve().parent
else:
    APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "svn_auto_tool_config.json"
LOG_DIR = APP_DIR / "logs"
LOG_RETENTION_DAYS = 7
MUSIC_EXTENSIONS = (".mp3", ".wav")
APP_VERSION = "v1.1.4"
LATEST_RELEASE_URL = "https://github.com/SusamMinami/SVNmate/releases/latest"
RELEASE_DOWNLOAD_URL = "https://github.com/SusamMinami/SVNmate/releases/download/{tag}/{asset}"
RELEASE_ASSET_NAME = "一键更新SVN.zip"


class SvnAutoTool:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title("P6-文案小组SVN懒人更新工具")
        self.root.geometry("1120x760")
        self.root.minsize(980, 640)

        self.folder_groups: dict[str, list[dict[str, object]]] = {"left": [], "right": []}
        self.folder_trees: dict[str, ttk.Treeview] = {}
        self.log_queue: queue.Queue[tuple[str, object]] = queue.Queue()
        self.worker_thread: threading.Thread | None = None
        self.running = False
        self.last_scheduled_key = ""
        self.last_bin_update_date = ""
        self.tortoise_proc = self._find_tortoise_proc()

        self.run_bin_update = BooleanVar(value=True)
        self.run_build_after_cleanup = BooleanVar(value=True)
        self.enable_schedule = BooleanVar(value=False)
        self.music_enabled = BooleanVar(value=True)
        self.custom_update_bat_path = StringVar(value="")
        self.custom_build_bat_path = StringVar(value="")
        self.schedule_time = StringVar(value="09:00")
        self.next_run_text = StringVar(value="未启用")
        self.status_text = StringVar(value="就绪")
        self.music_file = self._find_music_file()
        self.music_alias = f"svnmate_music_{id(self)}"
        self.music_backend = ""
        self.music_fading = False
        self.music_paused_after_task = False
        self.update_info: dict[str, str] | None = None
        self.update_state = "checking"
        self.current_theme = ""

        self._cleanup_old_logs()
        self._build_ui()
        self._load_config()
        self._refresh_music_button()
        self._apply_music_setting()
        self._theme_tick()
        self._refresh_folder_list()
        self._refresh_next_run_text()
        self._poll_log_queue()
        self._schedule_tick()
        self.root.after(2000, self._check_for_updates_async)

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self) -> None:
        main = ttk.Frame(self.root, padding=14)
        main.pack(fill=BOTH, expand=True)

        header = ttk.Frame(main)
        header.pack(fill=X)
        ttk.Label(header, text="P6-文案小组SVN懒人更新工具", font=("Microsoft YaHei UI", 16, "bold")).pack(side=LEFT)
        header_actions = ttk.Frame(header)
        header_actions.pack(side=RIGHT)
        ttk.Label(header_actions, textvariable=self.status_text).pack(side=LEFT, padx=(0, 12))
        self.ui_style = ttk.Style()
        self.ui_style.configure("Primary.TButton", font=("Microsoft YaHei UI", 12, "bold"), padding=(22, 10))
        self.ui_style.configure("LiveLog.Treeview", background="white", fieldbackground="white")
        self.ui_style.configure("Completed.LiveLog.Treeview", background="#E8F7E8", fieldbackground="#E8F7E8")
        self.music_button = ttk.Checkbutton(
            header_actions,
            text="音乐开",
            variable=self.music_enabled,
            command=self._on_music_toggle,
        )
        self.music_button.pack(side=LEFT, padx=(0, 12))
        self.run_button = ttk.Button(header_actions, text="立即执行", style="Primary.TButton", command=self._run_now)
        self.run_button.pack(side=LEFT)

        folder_frame = ttk.LabelFrame(main, text="需要自动更新的文件夹：只执行已勾选的项目", padding=10)
        folder_frame.pack(fill=BOTH, expand=False, pady=(12, 8))
        columns_frame = ttk.Frame(folder_frame)
        columns_frame.pack(fill=BOTH, expand=True)
        self._build_folder_column(columns_frame, "left", "栏目一")
        self._build_folder_column(columns_frame, "right", "栏目二")

        settings = ttk.Frame(main)
        settings.pack(fill=X, pady=8)

        options = ttk.LabelFrame(settings, text="执行选项", padding=10)
        options.pack(side=LEFT, fill=BOTH, expand=True, padx=(0, 8))
        self._build_option_script_row(
            options,
            self.run_bin_update,
            text="每日更新主干Bin包",
            choose_text="Update位置",
            choose_command=self._choose_update_bat_path,
            clear_command=self._clear_update_bat_path,
        )
        self._build_option_script_row(
            options,
            self.run_build_after_cleanup,
            text="Clean up完成后，自动运行res目录Build.bat",
            choose_text="Build位置",
            choose_command=self._choose_build_bat_path,
            clear_command=self._clear_build_bat_path,
            pady=(6, 0),
        )
        ttk.Label(options, text="说明：脚本位置留空时使用默认规则；svn update 完成后仍会自动执行 svn cleanup。").pack(anchor="w", pady=(6, 0))

        schedule = ttk.LabelFrame(settings, text="定时执行", padding=10)
        schedule.pack(side=LEFT, fill=BOTH, expand=True, padx=(8, 0))
        ttk.Checkbutton(schedule, text="启用每天定时执行", variable=self.enable_schedule, command=self._on_schedule_changed).pack(anchor="w")
        schedule_time_row = ttk.Frame(schedule)
        schedule_time_row.pack(fill=X, pady=(8, 0))
        ttk.Label(schedule_time_row, text="时间 HH:MM").pack(side=LEFT)
        time_entry = ttk.Entry(schedule_time_row, width=8, textvariable=self.schedule_time)
        time_entry.pack(side=LEFT, padx=(8, 0))
        time_entry.bind("<FocusOut>", lambda _event: self._on_schedule_changed())
        time_entry.bind("<Return>", lambda _event: self._on_schedule_changed())
        next_run_row = ttk.Frame(schedule)
        next_run_row.pack(fill=X, pady=(8, 0))
        ttk.Label(next_run_row, text="下次执行：").pack(side=LEFT)
        ttk.Label(next_run_row, textvariable=self.next_run_text).pack(side=LEFT)

        actions = ttk.Frame(main)
        actions.pack(fill=X, pady=(0, 8))
        ttk.Button(actions, text="保存配置", command=self._save_config).pack(side=LEFT, padx=(8, 0))
        ttk.Button(actions, text="打开日志文件夹", command=self._open_log_folder).pack(side=LEFT, padx=(8, 0))
        ttk.Button(actions, text="使用指南", command=self._open_user_guide).pack(side=RIGHT)

        live_frame = ttk.LabelFrame(main, text="实时输出", padding=10)
        live_frame.pack(fill=BOTH, expand=True, pady=(8, 0))
        self.live_log = ttk.Treeview(live_frame, columns=("line",), show="headings", height=13)
        self.live_log.configure(style="LiveLog.Treeview")
        self.live_log.heading("line", text="日志")
        self.live_log.column("line", width=880, anchor="w")
        self.live_log.pack(fill=BOTH, expand=True)

        self.update_dot = ttk.Label(main, text="○", style="UpdateDot.TLabel", cursor="hand2")
        self.update_dot.place(relx=1.0, rely=1.0, x=-90, y=-3, anchor="se")
        self.update_dot.bind("<Button-1>", lambda _event: self._on_update_dot_clicked())
        self.signature_label = ttk.Label(main, text="SusamMinami", style="Signature.TLabel")
        self.signature_label.place(relx=1.0, rely=1.0, x=-6, y=-2, anchor="se")

    def _build_folder_column(self, parent: ttk.Frame, group_key: str, title: str) -> None:
        column = ttk.Frame(parent)
        column.pack(side=LEFT, fill=BOTH, expand=True, padx=(0, 8) if group_key == "left" else (8, 0))

        toolbar = ttk.Frame(column)
        toolbar.pack(fill=X, pady=(0, 6))
        ttk.Button(toolbar, text="添加文件夹", command=lambda: self._add_folder(group_key)).pack(side=LEFT)
        ttk.Button(toolbar, text="移除选中", command=lambda: self._remove_selected_folder(group_key)).pack(side=LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="清空本栏", command=lambda: self._clear_folders(group_key)).pack(side=LEFT, padx=(8, 0))

        tree_frame = ttk.LabelFrame(column, text=title, padding=6)
        tree_frame.pack(fill=BOTH, expand=True)
        tree = ttk.Treeview(tree_frame, columns=("enabled", "path"), show="headings", height=8)
        tree.heading("enabled", text="执行")
        tree.heading("path", text="文件夹路径")
        tree.column("enabled", width=56, anchor="center", stretch=False)
        tree.column("path", width=430, anchor="w")
        tree.pack(side=LEFT, fill=BOTH, expand=True)
        scroll = ttk.Scrollbar(tree_frame, orient="vertical", command=tree.yview)
        scroll.pack(side=RIGHT, fill=Y)
        tree.configure(yscrollcommand=scroll.set)
        tree.bind("<Button-1>", lambda event, key=group_key: self._on_folder_tree_click(event, key))
        tree.bind("<Double-1>", lambda event, key=group_key: self._toggle_selected_folder(key))
        tree.bind("<space>", lambda _event, key=group_key: self._toggle_selected_folder(key))
        self.folder_trees[group_key] = tree

    def _build_option_script_row(
        self,
        parent: ttk.Frame,
        variable: BooleanVar,
        text: str,
        choose_text: str,
        choose_command: object,
        clear_command: object,
        pady: tuple[int, int] = (0, 0),
    ) -> None:
        row = ttk.Frame(parent)
        row.pack(fill=X, pady=pady)
        ttk.Button(row, text=choose_text, width=10, command=choose_command).pack(side=LEFT)
        ttk.Button(row, text="默认", width=6, command=clear_command).pack(side=LEFT, padx=(6, 8))
        ttk.Checkbutton(
            row,
            text=text,
            variable=variable,
            command=self._save_config,
        ).pack(side=LEFT, anchor="w")

    def _load_config(self) -> None:
        if not CONFIG_PATH.exists():
            return
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            messagebox.showwarning("配置读取失败", "配置文件无法读取，已使用默认配置。")
            return
        self.folder_groups = self._load_folder_groups(data)
        self.run_bin_update.set(bool(data.get("run_bin_update", True)))
        self.run_build_after_cleanup.set(bool(data.get("run_build_after_cleanup", True)))
        self.music_enabled.set(bool(data.get("music_enabled", True)))
        self.custom_update_bat_path.set(str(data.get("custom_update_bat_path", "")))
        self.custom_build_bat_path.set(str(data.get("custom_build_bat_path", "")))
        self.enable_schedule.set(bool(data.get("enable_schedule", False)))
        self.schedule_time.set(str(data.get("schedule_time", "09:00")))
        self.last_bin_update_date = str(data.get("last_bin_update_date", ""))

    def _save_config(self) -> None:
        data = {
            "folder_groups": self.folder_groups,
            "run_bin_update": self.run_bin_update.get(),
            "run_build_after_cleanup": self.run_build_after_cleanup.get(),
            "music_enabled": True if self.music_paused_after_task else self.music_enabled.get(),
            "custom_update_bat_path": self.custom_update_bat_path.get().strip(),
            "custom_build_bat_path": self.custom_build_bat_path.get().strip(),
            "enable_schedule": self.enable_schedule.get(),
            "schedule_time": self.schedule_time.get().strip(),
            "last_bin_update_date": self.last_bin_update_date,
        }
        CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        self._refresh_next_run_text()

    def _choose_update_bat_path(self) -> None:
        self._choose_script_path(self.custom_update_bat_path, "选择 Update.bat")

    def _choose_build_bat_path(self) -> None:
        self._choose_script_path(self.custom_build_bat_path, "选择 Build.bat")

    def _clear_update_bat_path(self) -> None:
        self.custom_update_bat_path.set("")
        self._save_config()

    def _clear_build_bat_path(self) -> None:
        self.custom_build_bat_path.set("")
        self._save_config()

    def _choose_script_path(self, target: StringVar, title: str) -> None:
        file_path = filedialog.askopenfilename(
            title=title,
            filetypes=(("Batch 文件", "*.bat"), ("所有文件", "*.*")),
        )
        if not file_path:
            return
        target.set(self._script_path_for_config(Path(file_path)))
        self._save_config()

    def _script_path_for_config(self, script_path: Path) -> str:
        try:
            script_resolved = script_path.resolve()
        except OSError:
            script_resolved = script_path
        candidates = []
        for folder_items in self.folder_groups.values():
            for item in folder_items:
                path_text = str(item.get("path", ""))
                if path_text:
                    candidates.append(Path(path_text))
        candidates.sort(key=lambda path: len(str(path)), reverse=True)
        for base in candidates:
            try:
                base_resolved = base.resolve()
                return str(script_resolved.relative_to(base_resolved))
            except (OSError, ValueError):
                continue
        return str(script_path)

    def _find_music_file(self) -> Path | None:
        for path in sorted(APP_DIR.iterdir()):
            if path.is_file() and path.suffix.lower() in MUSIC_EXTENSIONS:
                return path
        return None

    def _on_music_toggle(self) -> None:
        self.music_fading = False
        self.music_paused_after_task = False
        self._apply_music_setting()
        self._refresh_music_button()
        self._save_config()

    def _apply_music_setting(self) -> None:
        if os.name != "nt":
            return
        if self.music_enabled.get() and self.music_file and self.music_file.exists():
            self._start_music()
        else:
            self._stop_music()

    def _start_music(self) -> None:
        self._stop_music()
        self.music_backend = ""
        if self.music_file and self._mci_open_music(self.music_file):
            self._mci_set_volume(1000)
            if self._mci_command(f"play {self.music_alias} repeat"):
                self.music_backend = "mci"
                return
            self._mci_command(f"close {self.music_alias}")
        if self.music_file and self.music_file.suffix.lower() == ".wav":
            winsound.PlaySound(str(self.music_file), winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_LOOP)
            self.music_backend = "winsound"

    def _stop_music(self) -> None:
        if os.name != "nt":
            return
        if self.music_backend == "mci":
            self._mci_command(f"stop {self.music_alias}")
            self._mci_command(f"close {self.music_alias}")
        winsound.PlaySound(None, 0)
        self.music_backend = ""

    def _fade_out_music_after_tasks(self) -> None:
        if os.name != "nt" or not self.music_enabled.get() or self.music_fading:
            return
        self.music_fading = True

        def fade_worker() -> None:
            if self.music_backend == "mci":
                for volume in range(900, -1, -100):
                    if not self.music_fading:
                        return
                    self._mci_set_volume(volume)
                    time.sleep(0.12)
            else:
                time.sleep(0.6)
            self._stop_music()

            def mark_paused() -> None:
                self.music_paused_after_task = True
                self.music_enabled.set(False)
                self.music_fading = False
                self._refresh_music_button()
                self._save_config()

            self.root.after(0, mark_paused)

        threading.Thread(target=fade_worker, daemon=True).start()

    def _mci_open_music(self, music_file: Path) -> bool:
        media_type = "mpegvideo" if music_file.suffix.lower() == ".mp3" else "waveaudio"
        return self._mci_command(f'open "{music_file}" type {media_type} alias {self.music_alias}')

    def _mci_set_volume(self, volume: int) -> bool:
        volume = max(0, min(1000, volume))
        return self._mci_command(f"setaudio {self.music_alias} volume to {volume}")

    @staticmethod
    def _mci_command(command: str) -> bool:
        if os.name != "nt":
            return False
        buffer = ctypes.create_unicode_buffer(255)
        result = ctypes.windll.winmm.mciSendStringW(command, buffer, 254, 0)
        return result == 0

    def _refresh_music_button(self) -> None:
        if not hasattr(self, "music_button"):
            return
        if not self.music_file:
            self.music_button.configure(text="无音乐", state="disabled")
        else:
            self.music_button.configure(text="音乐开" if self.music_enabled.get() else "音乐关", state="normal")

    def _theme_tick(self) -> None:
        theme = "night" if self._is_night_time() else "day"
        if theme != self.current_theme:
            self.current_theme = theme
            self._apply_visual_theme(theme)
        self.root.after(60000, self._theme_tick)

    @staticmethod
    def _is_night_time() -> bool:
        hour = datetime.now().hour
        return hour >= 19 or hour < 6

    def _apply_visual_theme(self, theme: str) -> None:
        if theme == "night":
            try:
                self.ui_style.theme_use("clam")
            except Exception:
                pass
            colors = {
                "bg": "#141821",
                "panel": "#1F2633",
                "text": "#ECE7DC",
                "muted": "#C8BFAF",
                "accent": "#F2A65A",
                "entry": "#242C3A",
                "tree": "#18202B",
                "tree_text": "#F3EDE2",
                "selected": "#3A4A60",
                "completed": "#21442D",
            }
        else:
            try:
                self.ui_style.theme_use("vista")
            except Exception:
                pass
            colors = {
                "bg": "#F0F0F0",
                "panel": "#F0F0F0",
                "text": "#1F1F1F",
                "muted": "#5F5F5F",
                "accent": "#1F1F1F",
                "entry": "white",
                "tree": "white",
                "tree_text": "#1F1F1F",
                "selected": "#0078D7",
                "completed": "#E8F7E8",
            }

        self.root.configure(bg=colors["bg"])
        self.ui_style.configure(".", background=colors["panel"], foreground=colors["text"])
        self.ui_style.configure("TFrame", background=colors["panel"])
        self.ui_style.configure("TLabel", background=colors["panel"], foreground=colors["text"])
        self.ui_style.configure("TCheckbutton", background=colors["panel"], foreground=colors["text"])
        self.ui_style.configure("TLabelframe", background=colors["panel"], foreground=colors["text"])
        self.ui_style.configure("TLabelframe.Label", background=colors["panel"], foreground=colors["accent"])
        self.ui_style.configure("Signature.TLabel", background=colors["panel"], foreground=colors["muted"], font=("Segoe UI", 9, "italic"))
        self.ui_style.configure("UpdateDot.TLabel", background=colors["panel"], foreground=colors["muted"], font=("Segoe UI", 11, "bold"))
        self.ui_style.configure("UpdateDotReady.TLabel", background=colors["panel"], foreground="#D93636", font=("Segoe UI", 11, "bold"))
        self.ui_style.configure("LiveLog.Treeview", background=colors["tree"], fieldbackground=colors["tree"], foreground=colors["tree_text"])
        self.ui_style.configure("Completed.LiveLog.Treeview", background=colors["completed"], fieldbackground=colors["completed"], foreground=colors["tree_text"])
        self.ui_style.map("Treeview", background=[("selected", colors["selected"])], foreground=[("selected", "white")])
        self._refresh_update_dot()
        if self.status_text.get() == "已完成":
            self.live_log.configure(style="Completed.LiveLog.Treeview")
        else:
            self.live_log.configure(style="LiveLog.Treeview")

    def _load_folder_groups(self, data: dict[str, object]) -> dict[str, list[dict[str, object]]]:
        loaded = data.get("folder_groups")
        if isinstance(loaded, dict):
            return {
                "left": self._normalize_folder_items(loaded.get("left", [])),
                "right": self._normalize_folder_items(loaded.get("right", [])),
            }

        old_folders = data.get("folders", [])
        return {
            "left": [{"path": str(Path(p)), "enabled": True} for p in old_folders if p],
            "right": [],
        }

    @staticmethod
    def _normalize_folder_items(items: object) -> list[dict[str, object]]:
        normalized: list[dict[str, object]] = []
        if not isinstance(items, list):
            return normalized
        for item in items:
            if isinstance(item, dict):
                path = item.get("path")
                if path:
                    normalized.append({"path": str(Path(str(path))), "enabled": bool(item.get("enabled", True))})
            elif item:
                normalized.append({"path": str(Path(str(item))), "enabled": True})
        return normalized

    def _refresh_folder_list(self) -> None:
        for group_key, tree in self.folder_trees.items():
            for item in tree.get_children():
                tree.delete(item)
            for index, folder_item in enumerate(self.folder_groups[group_key]):
                checked = "[x]" if bool(folder_item.get("enabled", True)) else "[ ]"
                tree.insert("", END, iid=str(index), values=(checked, folder_item.get("path", "")))

    def _add_folder(self, group_key: str) -> None:
        folder = filedialog.askdirectory(title="选择需要执行 svn update 的文件夹")
        if not folder:
            return
        normalized = str(Path(folder))
        if self._folder_exists(normalized):
            messagebox.showinfo("文件夹已存在", "这个文件夹已经在列表中了。")
            return
        self.folder_groups[group_key].append({"path": normalized, "enabled": True})
        self._refresh_folder_list()
        self._save_config()

    def _remove_selected_folder(self, group_key: str) -> None:
        tree = self.folder_trees[group_key]
        selected = tree.selection()
        if not selected:
            return
        selected_indexes = {int(item) for item in selected}
        self.folder_groups[group_key] = [
            item for index, item in enumerate(self.folder_groups[group_key]) if index not in selected_indexes
        ]
        self._refresh_folder_list()
        self._save_config()

    def _clear_folders(self, group_key: str) -> None:
        if self.folder_groups[group_key] and not messagebox.askyesno("确认清空", "确定要清空本栏所有文件夹吗？"):
            return
        self.folder_groups[group_key] = []
        self._refresh_folder_list()
        self._save_config()

    def _folder_exists(self, path: str) -> bool:
        target = path.lower()
        for folder_items in self.folder_groups.values():
            for item in folder_items:
                if str(item.get("path", "")).lower() == target:
                    return True
        return False

    def _on_folder_tree_click(self, event: object, group_key: str) -> None:
        tree = self.folder_trees[group_key]
        row_id = tree.identify_row(event.y)
        column = tree.identify_column(event.x)
        if row_id and column == "#1":
            self._toggle_folder(group_key, int(row_id))

    def _toggle_selected_folder(self, group_key: str) -> None:
        tree = self.folder_trees[group_key]
        for row_id in tree.selection():
            self._toggle_folder(group_key, int(row_id))

    def _toggle_folder(self, group_key: str, index: int) -> None:
        if index < 0 or index >= len(self.folder_groups[group_key]):
            return
        item = self.folder_groups[group_key][index]
        item["enabled"] = not bool(item.get("enabled", True))
        self._refresh_folder_list()
        self._save_config()

    def _get_enabled_folders(self) -> list[str]:
        enabled_paths: list[str] = []
        for folder_items in self.folder_groups.values():
            for item in folder_items:
                if bool(item.get("enabled", True)) and item.get("path"):
                    enabled_paths.append(str(item["path"]))
        return enabled_paths

    def _on_schedule_changed(self) -> None:
        if self.enable_schedule.get() and self._parse_schedule_time() is None:
            messagebox.showwarning("时间格式不正确", "请使用 HH:MM 格式，例如 09:00 或 18:30。")
            self.enable_schedule.set(False)
        self._save_config()

    def _parse_schedule_time(self) -> tuple[int, int] | None:
        text = self.schedule_time.get().strip()
        try:
            hour_text, minute_text = text.split(":", 1)
            hour = int(hour_text)
            minute = int(minute_text)
        except ValueError:
            return None
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
        return None

    def _refresh_next_run_text(self) -> None:
        if not self.enable_schedule.get():
            self.next_run_text.set("未启用")
            return
        parsed = self._parse_schedule_time()
        if parsed is None:
            self.next_run_text.set("时间格式错误")
            return
        hour, minute = parsed
        now = datetime.now()
        next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)
        self.next_run_text.set(next_run.strftime("%Y-%m-%d %H:%M"))

    def _schedule_tick(self) -> None:
        self._refresh_next_run_text()
        if self.enable_schedule.get() and not self.running:
            parsed = self._parse_schedule_time()
            if parsed is not None:
                hour, minute = parsed
                now = datetime.now()
                schedule_key = now.strftime("%Y-%m-%d %H:%M")
                if now.hour == hour and now.minute == minute and self.last_scheduled_key != schedule_key:
                    self.last_scheduled_key = schedule_key
                    self._start_worker(trigger="定时执行")
        self.root.after(1000, self._schedule_tick)

    def _run_now(self) -> None:
        self._start_worker(trigger="手动执行")

    def _start_worker(self, trigger: str) -> None:
        if self.running:
            messagebox.showinfo("正在执行", "当前任务还没有结束，请稍后再试。")
            return
        enabled_folders = self._get_enabled_folders()
        if not enabled_folders:
            messagebox.showwarning("没有勾选文件夹", "请先勾选至少一个需要更新的文件夹。")
            return
        self._save_config()
        self.running = True
        self.run_button.configure(state="disabled")
        self.live_log.configure(style="LiveLog.Treeview")
        self.status_text.set(f"{trigger}中...")
        self._log(f"========== {trigger}开始：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ==========")
        self.worker_thread = threading.Thread(target=self._run_all_tasks, args=(trigger, enabled_folders), daemon=True)
        self.worker_thread.start()

    def _run_all_tasks(self, trigger: str, enabled_folders: list[str]) -> None:
        today = datetime.now().strftime("%Y-%m-%d")
        run_daily_bin_update = self.run_bin_update.get() and self.last_bin_update_date != today
        bin_update_attempted = False
        bin_update_all_success = True
        try:
            for folder_text in enabled_folders:
                folder = Path(folder_text)
                if not folder.exists() or not folder.is_dir():
                    self._record(folder_text, "检查文件夹", "失败", "文件夹不存在")
                    continue
                attempted, success = self._run_for_folder(folder, run_daily_bin_update)
                bin_update_attempted = bin_update_attempted or attempted
                bin_update_all_success = bin_update_all_success and success
            if run_daily_bin_update and bin_update_attempted and bin_update_all_success:
                self.last_bin_update_date = today
        finally:
            self.log_queue.put(("done", trigger))

    def _run_for_folder(self, folder: Path, run_daily_bin_update: bool) -> tuple[bool, bool]:
        bin_update_attempted = False
        bin_update_success = True
        update_ok = self._run_command(folder, self._svn_update_command(folder), "svn update", auto_cleanup=True)

        if update_ok and run_daily_bin_update:
            update_scripts = self._find_update_bat_scripts(folder)
            if update_scripts:
                for update_bat in update_scripts:
                    bin_update_attempted = True
                    bin_update_success = self._run_command(
                        update_bat.parent,
                        self._bat_command(update_bat),
                        "Update.bat",
                        visible_console=True,
                    ) and bin_update_success
            elif self.custom_update_bat_path.get().strip():
                bin_update_attempted = True
                bin_update_success = False
                self._record(str(folder), "Update.bat", "跳过", f"未找到自定义路径：{self.custom_update_bat_path.get().strip()}")
            else:
                for bin_folder in self._find_bin_folders(folder):
                    bin_update_attempted = True
                    bin_update_success = False
                    self._record(str(bin_folder / "WindowsNoEditor"), "Update.bat", "跳过", "未找到 WindowsNoEditor\\Update.bat")

        cleanup_ok = self._run_command(folder, self._svn_cleanup_command(folder), "svn cleanup")

        if cleanup_ok and self.run_build_after_cleanup.get():
            build_scripts = self._find_build_bat_scripts(folder)
            if build_scripts:
                for build_bat in build_scripts:
                    self._run_command(build_bat.parent, self._bat_command(build_bat), "Build.bat", visible_console=True)
            elif self.custom_build_bat_path.get().strip():
                self._record(str(folder), "Build.bat", "跳过", f"未找到自定义路径：{self.custom_build_bat_path.get().strip()}")
            else:
                for res_folder in self._find_res_folders(folder):
                    self._record(str(res_folder), "Build.bat", "跳过", "未找到 Build.bat")
        return bin_update_attempted, bin_update_success

    def _find_update_bat_scripts(self, folder: Path) -> list[Path]:
        custom = self._resolve_custom_script(folder, self.custom_update_bat_path.get())
        if custom:
            return [custom]
        candidates = []
        for bin_folder in self._find_bin_folders(folder):
            update_bat = bin_folder / "WindowsNoEditor" / "Update.bat"
            if update_bat.exists():
                candidates.append(update_bat)
        return self._dedupe_paths(candidates)

    def _find_build_bat_scripts(self, folder: Path) -> list[Path]:
        custom = self._resolve_custom_script(folder, self.custom_build_bat_path.get())
        if custom:
            return [custom]
        candidates = []
        for res_folder in self._find_res_folders(folder):
            build_bat = res_folder / "Build.bat"
            if build_bat.exists():
                candidates.append(build_bat)
        return self._dedupe_paths(candidates)

    @staticmethod
    def _resolve_custom_script(folder: Path, script_path_text: str) -> Path | None:
        script_path_text = script_path_text.strip()
        if not script_path_text:
            return None
        script_path = Path(script_path_text)
        if not script_path.is_absolute():
            script_path = folder / script_path
        if script_path.exists() and script_path.is_file():
            return script_path
        return None

    def _find_bin_folders(self, folder: Path) -> list[Path]:
        candidates: list[Path] = []
        if folder.name.lower() == "bin" and (folder / "WindowsNoEditor").is_dir():
            candidates.append(folder)
        nested_bin = folder / "bin"
        if (nested_bin / "WindowsNoEditor").is_dir():
            candidates.append(nested_bin)
        return self._dedupe_paths(candidates)

    def _find_res_folders(self, folder: Path) -> list[Path]:
        candidates: list[Path] = []
        if folder.name.lower() == "res":
            candidates.append(folder)
        nested_res = folder / "res"
        if nested_res.is_dir():
            candidates.append(nested_res)
        return self._dedupe_paths(candidates)

    @staticmethod
    def _dedupe_paths(paths: list[Path]) -> list[Path]:
        seen: set[str] = set()
        result: list[Path] = []
        for path in paths:
            key = str(path.resolve()).lower()
            if key not in seen:
                seen.add(key)
                result.append(path)
        return result

    @staticmethod
    def _bat_command(bat_path: Path) -> list[str]:
        return ["cmd", "/v:on", "/d", "/c", f'call "{bat_path}"']

    @staticmethod
    def _find_tortoise_proc() -> str | None:
        from_path = shutil.which("TortoiseProc.exe") or shutil.which("TortoiseProc")
        if from_path:
            return from_path
        default_path = Path(r"C:\Program Files\TortoiseSVN\bin\TortoiseProc.exe")
        if default_path.exists():
            return str(default_path)
        return None

    def _svn_update_command(self, folder: Path) -> list[str]:
        if self.tortoise_proc:
            return [
                self.tortoise_proc,
                "/command:update",
                f"/path:{folder}",
                "/closeonend:1",
            ]
        return ["svn", "update"]

    def _svn_cleanup_command(self, folder: Path) -> list[str]:
        if self.tortoise_proc:
            return [
                self.tortoise_proc,
                "/command:cleanup",
                f"/path:{folder}",
                "/cleanup",
                "/noui",
                "/breaklocks",
                "/refreshshell",
                "/closeonend:1",
            ]
        return ["svn", "cleanup"]

    def _is_tortoise_command(self, command: list[str]) -> bool:
        return bool(self.tortoise_proc and command and str(Path(command[0])).lower() == str(Path(self.tortoise_proc)).lower())

    def _run_command(
        self,
        cwd: Path,
        command: list[str],
        action: str,
        auto_cleanup: bool = False,
        visible_console: bool = False,
    ) -> bool:
        self._log(f"[开始] {action} | {cwd}")
        started = datetime.now()
        try:
            if self._is_tortoise_command(command):
                return_code, output, error = self._run_tortoise_command(cwd, command)
            elif visible_console:
                return_code, output, error = self._run_visible_console_command(cwd, command)
            else:
                process = subprocess.run(
                    command,
                    cwd=str(cwd),
                    capture_output=True,
                    text=True,
                    shell=False,
                    creationflags=self._creation_flags(),
                )
                return_code = process.returncode
                output = (process.stdout or "").strip()
                error = (process.stderr or "").strip()
        except FileNotFoundError as exc:
            self._record(str(cwd), action, "失败", f"命令不存在：{exc.filename}")
            return False
        except OSError as exc:
            self._record(str(cwd), action, "失败", str(exc))
            return False

        elapsed = (datetime.now() - started).total_seconds()
        if output:
            self._log(output)
        if error:
            self._log(error)

        if return_code == 0:
            self._record(str(cwd), action, "成功", f"耗时 {elapsed:.1f}s")
            return True

        if action == "Build.bat" and visible_console:
            self._record(str(cwd), action, "完成", f"CMD 窗口已结束，返回码 {return_code}")
            return True

        message = error or output or f"退出码 {return_code}"
        if auto_cleanup and self._needs_svn_cleanup(message):
            self._record(str(cwd), action, "需要清理", "SVN 提示需要先执行 cleanup，正在自动处理")
            cleanup_ok = self._run_command(cwd, self._svn_cleanup_command(cwd), "svn cleanup(自动)")
            if cleanup_ok:
                self._record(str(cwd), action, "重试", "cleanup 完成，重新执行 svn update")
                return self._run_command(cwd, command, action, auto_cleanup=False)
            self._record(str(cwd), action, "失败", "自动 cleanup 失败，已停止重试")
            return False

        self._record(str(cwd), action, "失败", message[:300])
        return False

    def _run_visible_console_command(self, cwd: Path, command: list[str]) -> tuple[int, str, str]:
        console_title = f"SVNmate Build {int(time.time() * 1000)}"
        command = self._add_console_title(command, console_title)
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            stdin=None,
            stdout=None,
            stderr=None,
            text=True,
            shell=False,
            creationflags=self._visible_console_flags(),
        )
        started_at = time.time()
        last_enter_at = 0.0
        while process.poll() is None:
            now = time.time()
            if now - started_at > 5 and now - last_enter_at > 5:
                self._press_enter_for_process_window(process.pid, console_title)
                last_enter_at = now
            time.sleep(0.5)
        return_code = process.returncode
        self._close_process_windows(process.pid, console_title)
        return return_code, "", ""

    @staticmethod
    def _add_console_title(command: list[str], title: str) -> list[str]:
        normalized = [part.lower() for part in command]
        if not normalized or normalized[0] != "cmd" or "/c" not in normalized:
            return command
        command_index = normalized.index("/c") + 1
        if command_index >= len(command):
            return command
        body = command[command_index]
        failure_hold = (
            'set "SVNMATE_RC=!ERRORLEVEL!" & '
            'if not "!SVNMATE_RC!"=="0" ('
            "echo. & "
            "echo [SVNmate] BAT 执行返回码：!SVNMATE_RC! & "
            "echo [SVNmate] 窗口将在 5 秒后自动关闭，也可以手动关闭。 & "
            "timeout /t 5 /nobreak >nul"
            ') & '
            "exit /b !SVNMATE_RC!"
        )
        titled = command.copy()
        titled[command_index] = f"title {title} & {body} & {failure_hold}"
        return titled

    def _run_tortoise_command(self, cwd: Path, command: list[str]) -> tuple[int, str, str]:
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=False,
            creationflags=self._creation_flags(),
        )
        while process.poll() is None:
            if self._click_tortoise_done_buttons(process.pid, require_completion=True):
                self._log("已自动关闭 TortoiseSVN 完成提示窗口")
            time.sleep(0.5)
        output, error = process.communicate()
        time.sleep(0.5)
        return process.returncode or 0, (output or "").strip(), (error or "").strip()

    def _click_tortoise_done_buttons(
        self,
        process_id: int,
        require_completion: bool,
    ) -> bool:
        if os.name != "nt":
            return False

        clicked = False
        button_texts = {"ok", "确定", "确认", "关闭", "close"}
        title_keywords = {"tortoisesvn", "clean up", "cleanup", "update", "svn", "subversion", "清理", "更新"}
        complete_keywords = {
            "finished",
            "completed",
            "complete",
            "succeeded",
            "successfully",
            "at revision",
            "updated to revision",
            "cleaned up",
            "clean up finished",
            "cleanup has finished",
            "operation completed",
            "done",
            "no files were changed",
            "working copy",
            "完成",
            "已完成",
            "成功",
            "更新完成",
            "清理完成",
            "没有文件",
            "工作副本",
        }
        user32 = ctypes.windll.user32

        enum_windows_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        def get_window_text(hwnd: int) -> str:
            length = user32.GetWindowTextLengthW(hwnd)
            buffer = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buffer, length + 1)
            return buffer.value.strip()

        def normalize_button_text(text: str) -> str:
            return (
                text.lower()
                .replace("&", "")
                .replace(" ", "")
                .replace("\t", "")
                .replace("（", "(")
                .replace("）", ")")
            )

        def is_done_button(text: str) -> bool:
            normalized = normalize_button_text(text)
            return (
                normalized in button_texts
                or normalized.startswith("ok(")
                or normalized.startswith("确定(")
                or normalized.startswith("确认(")
                or normalized.startswith("close(")
                or normalized.startswith("关闭(")
            )

        def enum_child_callback(child_hwnd: int, _lparam: int) -> bool:
            nonlocal clicked
            text = get_window_text(child_hwnd)
            if is_done_button(text):
                user32.SendMessageW(child_hwnd, 0x00F5, 0, 0)  # BM_CLICK
                clicked = True
            return True

        def enum_window_callback(hwnd: int, _lparam: int) -> bool:
            window_pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(window_pid))
            if not user32.IsWindowVisible(hwnd):
                return True
            title = get_window_text(hwnd)
            if window_pid.value != process_id:
                return True
            window_texts = [title]

            def collect_text_callback(child_hwnd: int, _lparam: int) -> bool:
                text = get_window_text(child_hwnd)
                if text:
                    window_texts.append(text)
                return True

            collect_callback = enum_windows_proc(collect_text_callback)
            user32.EnumChildWindows(hwnd, collect_callback, 0)
            all_text = "\n".join(window_texts).lower()
            if not require_completion or any(keyword in all_text for keyword in complete_keywords):
                child_callback = enum_windows_proc(enum_child_callback)
                user32.EnumChildWindows(hwnd, child_callback, 0)
            return True

        user32.EnumWindows(enum_windows_proc(enum_window_callback), 0)
        return clicked

    def _press_enter_for_process_window(self, process_id: int, title_keyword: str = "") -> bool:
        if os.name != "nt":
            return False

        sent = False
        user32 = ctypes.windll.user32
        enum_windows_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        wm_keydown = 0x0100
        wm_keyup = 0x0101
        vk_return = 0x0D

        def get_window_text(hwnd: int) -> str:
            length = user32.GetWindowTextLengthW(hwnd)
            buffer = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buffer, length + 1)
            return buffer.value.strip()

        def enum_window_callback(hwnd: int, _lparam: int) -> bool:
            nonlocal sent
            window_pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(window_pid))
            title = get_window_text(hwnd)
            title_matches = bool(title_keyword and title_keyword.lower() in title.lower())
            if user32.IsWindowVisible(hwnd) and (window_pid.value == process_id or title_matches):
                user32.PostMessageW(hwnd, wm_keydown, vk_return, 0)
                user32.PostMessageW(hwnd, wm_keyup, vk_return, 0)
                sent = True
            return True

        user32.EnumWindows(enum_windows_proc(enum_window_callback), 0)
        return sent

    def _close_process_windows(self, process_id: int, title_keyword: str = "") -> bool:
        if os.name != "nt":
            return False

        closed = False
        user32 = ctypes.windll.user32
        enum_windows_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        wm_close = 0x0010

        def get_window_text(hwnd: int) -> str:
            length = user32.GetWindowTextLengthW(hwnd)
            buffer = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buffer, length + 1)
            return buffer.value.strip()

        def enum_window_callback(hwnd: int, _lparam: int) -> bool:
            nonlocal closed
            window_pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(window_pid))
            title = get_window_text(hwnd)
            title_matches = bool(title_keyword and title_keyword.lower() in title.lower())
            if user32.IsWindowVisible(hwnd) and (window_pid.value == process_id or title_matches):
                user32.PostMessageW(hwnd, wm_close, 0, 0)
                closed = True
            return True

        user32.EnumWindows(enum_windows_proc(enum_window_callback), 0)
        return closed

    @staticmethod
    def _needs_svn_cleanup(message: str) -> bool:
        normalized = message.lower()
        keywords = [
            "run 'svn cleanup'",
            "run svn cleanup",
            "run 'cleanup'",
            "working copy locked",
            "previous operation has not finished",
            "please execute the 'cleanup' command",
            "e155004",
            "e155037",
            "需要先执行",
            "执行清理",
            "工作副本被锁定",
        ]
        return any(keyword in normalized for keyword in keywords)

    @staticmethod
    def _creation_flags() -> int:
        if os.name == "nt":
            return subprocess.CREATE_NO_WINDOW
        return 0

    @staticmethod
    def _visible_console_flags() -> int:
        if os.name == "nt":
            return subprocess.CREATE_NEW_CONSOLE
        return 0

    def _record(self, folder: str, action: str, status: str, message: str) -> None:
        finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._log(f"[{status}] {finished_at} | {action} | {folder} | {message}")

    def _log(self, line: str) -> None:
        timestamped = f"{datetime.now().strftime('%H:%M:%S')}  {line}"
        self.log_queue.put(("log", timestamped))
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            with self._current_log_path().open("a", encoding="utf-8") as fp:
                fp.write(timestamped + "\n")
        except OSError:
            pass

    def _current_log_path(self) -> Path:
        return LOG_DIR / f"svn_auto_tool_{datetime.now().strftime('%Y-%m-%d')}.log"

    def _cleanup_old_logs(self) -> None:
        if not LOG_DIR.exists():
            return
        cutoff = datetime.now() - timedelta(days=LOG_RETENTION_DAYS)
        for log_file in LOG_DIR.glob("svn_auto_tool_*.log"):
            try:
                modified_at = datetime.fromtimestamp(log_file.stat().st_mtime)
                if modified_at < cutoff:
                    log_file.unlink()
            except OSError:
                pass

    def _poll_log_queue(self) -> None:
        try:
            while True:
                item_type, payload = self.log_queue.get_nowait()
                if item_type == "log":
                    self.live_log.insert("", END, values=(payload,))
                    children = self.live_log.get_children()
                    if len(children) > 300:
                        self.live_log.delete(children[0])
                    self.live_log.yview_moveto(1.0)
                elif item_type == "done":
                    self.running = False
                    self.run_button.configure(state="normal")
                    self.status_text.set("已完成")
                    self._save_config()
                    self._log(f"========== {payload}结束：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ==========")
                    self._log("全部任务已完成")
                    self.live_log.configure(style="Completed.LiveLog.Treeview")
                    self._fade_out_music_after_tasks()
        except queue.Empty:
            pass
        self.root.after(200, self._poll_log_queue)

    def _open_log_folder(self) -> None:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(str(LOG_DIR))

    def _open_user_guide(self) -> None:
        webbrowser.open("https://bytedance.larkoffice.com/docx/BdDod9tjIo4rPbx2oWHchVRUnwh")

    def _check_for_updates_async(self) -> None:
        self.update_state = "checking"
        self._refresh_update_dot()
        threading.Thread(target=self._check_for_updates_worker, daemon=True).start()

    def _check_for_updates_worker(self) -> None:
        try:
            info = self._fetch_latest_release()
            has_update = bool(info and self._is_newer_version(info.get("tag_name", ""), APP_VERSION))
        except Exception as exc:
            self._log(f"检查更新失败：{exc}")
            self.root.after(0, lambda: self._set_update_state("idle", None))
            return
        self.root.after(0, lambda: self._set_update_state("ready" if has_update else "idle", info if has_update else None))

    def _set_update_state(self, state: str, info: dict[str, str] | None) -> None:
        self.update_state = state
        self.update_info = info
        self._refresh_update_dot()
        if state == "ready" and info:
            self._log(f"发现新版本：{info.get('tag_name', '')}")

    def _refresh_update_dot(self) -> None:
        if not hasattr(self, "update_dot"):
            return
        if self.update_state == "ready":
            self.update_dot.configure(text="●", style="UpdateDotReady.TLabel")
        elif self.update_state in {"checking", "downloading"}:
            self.update_dot.configure(text="◌", style="UpdateDot.TLabel")
        else:
            self.update_dot.configure(text="○", style="UpdateDot.TLabel")

    def _on_update_dot_clicked(self) -> None:
        if self.update_state == "checking":
            messagebox.showinfo("检查更新", "正在检查更新，请稍后。")
            return
        if self.update_state == "downloading":
            messagebox.showinfo("正在更新", "正在下载更新包，请稍后。")
            return
        if self.update_state != "ready" or not self.update_info:
            self._check_for_updates_async()
            messagebox.showinfo("检查更新", "当前未发现新版本，已重新检查。")
            return
        tag = self.update_info.get("tag_name", "")
        if not messagebox.askyesno("发现新版本", f"发现 {tag}，是否立即下载并更新？"):
            return
        self.update_state = "downloading"
        self._refresh_update_dot()
        threading.Thread(target=self._download_update_worker, args=(self.update_info,), daemon=True).start()

    def _download_update_worker(self, info: dict[str, str]) -> None:
        try:
            asset_url = info["asset_url"]
            update_dir = APP_DIR / "_updates"
            update_dir.mkdir(parents=True, exist_ok=True)
            zip_path = update_dir / RELEASE_ASSET_NAME
            request = urllib.request.Request(asset_url, headers={"User-Agent": "SVNmate-Updater"})
            with urllib.request.urlopen(request, timeout=120) as response, zip_path.open("wb") as fp:
                shutil.copyfileobj(response, fp)
            self.root.after(0, lambda: self._confirm_apply_update(zip_path, info.get("tag_name", "")))
        except Exception as exc:
            self.root.after(0, lambda: self._update_download_failed(str(exc)))

    def _confirm_apply_update(self, zip_path: Path, tag: str) -> None:
        self.update_state = "ready"
        self._refresh_update_dot()
        if not messagebox.askyesno("更新已下载", f"{tag} 已下载完成。是否现在重启并应用更新？"):
            os.startfile(str(zip_path.parent))
            return
        self._launch_update_installer(zip_path)
        self._stop_music()
        self.root.destroy()

    def _update_download_failed(self, message: str) -> None:
        self.update_state = "ready" if self.update_info else "idle"
        self._refresh_update_dot()
        messagebox.showerror("更新失败", f"下载更新失败：{message}")

    def _launch_update_installer(self, zip_path: Path) -> None:
        update_dir = zip_path.parent
        script_path = update_dir / "apply_update.ps1"
        script = f"""
$ErrorActionPreference = 'Stop'
$pidToWait = {os.getpid()}
$appDir = {json.dumps(str(APP_DIR))}
$zipPath = {json.dumps(str(zip_path))}
$extractDir = Join-Path (Split-Path -Parent $zipPath) 'extract'
while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {{
    Start-Sleep -Milliseconds 500
}}
if (Test-Path $extractDir) {{ Remove-Item $extractDir -Recurse -Force }}
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
$payload = Join-Path $extractDir '一键更新SVN'
Copy-Item -Path (Join-Path $payload '*') -Destination $appDir -Recurse -Force
Start-Process -FilePath (Join-Path $appDir 'SVNAutoTool.exe')
"""
        script_path.write_text(script.strip(), encoding="utf-8")
        subprocess.Popen(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
            ],
            creationflags=self._visible_console_flags(),
        )

    @staticmethod
    def _fetch_latest_release() -> dict[str, str] | None:
        request = urllib.request.Request(LATEST_RELEASE_URL, headers={"User-Agent": "SVNmate-Updater"})
        with urllib.request.urlopen(request, timeout=10) as response:
            latest_url = response.geturl()
        marker = "/releases/tag/"
        if marker not in latest_url:
            return None
        tag_name = latest_url.rstrip("/").split(marker, 1)[1]
        encoded_asset = urllib.parse.quote(RELEASE_ASSET_NAME)
        return {
            "tag_name": tag_name,
            "html_url": latest_url,
            "asset_url": RELEASE_DOWNLOAD_URL.format(tag=urllib.parse.quote(tag_name), asset=encoded_asset),
        }

    @staticmethod
    def _is_newer_version(remote: str, local: str) -> bool:
        def parse(version: str) -> tuple[int, ...]:
            version = version.lower().lstrip("v")
            parts = []
            for part in version.split("."):
                number = ""
                for char in part:
                    if char.isdigit():
                        number += char
                    else:
                        break
                parts.append(int(number or "0"))
            return tuple(parts)

        return parse(remote) > parse(local)

    def _on_close(self) -> None:
        if self.running and not messagebox.askyesno("任务仍在执行", "任务还在执行中，确定要关闭工具吗？"):
            return
        self._save_config()
        self._stop_music()
        self.root.destroy()


def main() -> None:
    root = Tk()
    try:
        ttk.Style().theme_use("vista")
    except Exception:
        pass
    SvnAutoTool(root)
    root.mainloop()


if __name__ == "__main__":
    main()
