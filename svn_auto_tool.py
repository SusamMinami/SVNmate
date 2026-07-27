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


def _enable_windows_dpi_awareness() -> None:
    if os.name != "nt":
        return
    try:
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
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


_enable_windows_dpi_awareness()

from tkinter import BOTH, END, LEFT, RIGHT, X, Y, BooleanVar, StringVar, Tk, filedialog, messagebox
from tkinter import ttk


def _get_window_dpi(root: Tk) -> int:
    if os.name != "nt":
        return 96
    try:
        user32 = ctypes.windll.user32
        user32.GetParent.argtypes = [ctypes.c_void_p]
        user32.GetParent.restype = ctypes.c_void_p
        user32.GetDpiForWindow.argtypes = [ctypes.c_void_p]
        user32.GetDpiForWindow.restype = ctypes.c_uint
        child_hwnd = root.winfo_id()
        top_level_hwnd = user32.GetParent(child_hwnd) or child_hwnd
        dpi = int(user32.GetDpiForWindow(top_level_hwnd))
    except (AttributeError, OSError, ValueError):
        return 96
    return dpi if dpi > 0 else 96


def _configure_tk_dpi(root: Tk) -> int:
    root.update_idletasks()
    dpi = _get_window_dpi(root)
    root.tk.call("tk", "scaling", dpi / 72.0)
    return dpi


if os.name == "nt":
    import winsound
    from ctypes import wintypes


if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).resolve().parent
else:
    APP_DIR = Path(__file__).resolve().parent
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))
CONFIG_PATH = APP_DIR / "svn_auto_tool_config.json"
LOG_DIR = APP_DIR / "logs"
LOG_RETENTION_DAYS = 7
MUSIC_EXTENSIONS = (".mp3", ".wav")
APP_VERSION = "v1.3.2"
LATEST_RELEASE_URL = "https://github.com/SusamMinami/SVNmate/releases/latest"
RELEASE_DOWNLOAD_URL = "https://github.com/SusamMinami/SVNmate/releases/download/{tag}/{asset}"
RELEASE_ASSET_NAME = "一键更新SVN.zip"
KINDLE_STATUS_EXE_NAME = "KindleLarkStatus.exe"
APP_ICON_PATH = RESOURCE_DIR / "svnmate.ico"


if os.name == "nt":
    class _Guid(ctypes.Structure):
        _fields_ = [
            ("data1", wintypes.DWORD),
            ("data2", wintypes.WORD),
            ("data3", wintypes.WORD),
            ("data4", ctypes.c_ubyte * 8),
        ]


    class _NotifyIconData(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD),
            ("hWnd", wintypes.HWND),
            ("uID", wintypes.UINT),
            ("uFlags", wintypes.UINT),
            ("uCallbackMessage", wintypes.UINT),
            ("hIcon", wintypes.HICON),
            ("szTip", wintypes.WCHAR * 128),
            ("dwState", wintypes.DWORD),
            ("dwStateMask", wintypes.DWORD),
            ("szInfo", wintypes.WCHAR * 256),
            ("uVersion", wintypes.UINT),
            ("szInfoTitle", wintypes.WCHAR * 64),
            ("dwInfoFlags", wintypes.DWORD),
            ("guidItem", _Guid),
            ("hBalloonIcon", wintypes.HICON),
        ]

    class _WindowClass(ctypes.Structure):
        _fields_ = [
            ("style", wintypes.UINT),
            ("lpfnWndProc", ctypes.c_void_p),
            ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE),
            ("hIcon", wintypes.HICON),
            ("hCursor", wintypes.HANDLE),
            ("hbrBackground", wintypes.HBRUSH),
            ("lpszMenuName", wintypes.LPCWSTR),
            ("lpszClassName", wintypes.LPCWSTR),
        ]


class WindowsTrayIcon:
    NIM_ADD = 0
    NIM_DELETE = 2
    NIF_MESSAGE = 0x1
    NIF_ICON = 0x2
    NIF_TIP = 0x4
    WM_TRAYICON = 0x8000 + 27
    WM_LBUTTONDBLCLK = 0x0203
    WM_RBUTTONUP = 0x0205
    WM_CONTEXTMENU = 0x007B
    WM_CLOSE = 0x0010
    WM_DESTROY = 0x0002
    IMAGE_ICON = 1
    LR_LOADFROMFILE = 0x0010
    ID_SHOW = 1001
    ID_RUN = 1002
    ID_EXIT = 1003

    def __init__(
        self,
        root: Tk,
        on_show: object,
        on_run: object,
        on_exit: object,
        icon_path: Path,
    ) -> None:
        self.root = root
        self.on_show = on_show
        self.on_run = on_run
        self.on_exit = on_exit
        self.icon_path = icon_path
        self.available = False
        self.hwnd = 0
        self.icon_handle = 0
        self.owns_icon = False
        self._notify_data = None
        self._window_proc_callback = None
        self._thread: threading.Thread | None = None
        self._ready_event = threading.Event()
        self._actions: queue.Queue[str] = queue.Queue()
        self._class_name = f"SVNmateTrayWindow_{os.getpid()}_{id(self)}"
        self._instance = 0

    def start(self) -> bool:
        if os.name != "nt" or self.available:
            return self.available
        if self._thread and self._thread.is_alive():
            return self.available
        self._ready_event.clear()
        self._thread = threading.Thread(target=self._message_loop, name="svnmate-tray", daemon=True)
        self._thread.start()
        self._ready_event.wait(3)
        return self.available

    def stop(self) -> None:
        if os.name != "nt":
            return
        if self.hwnd:
            ctypes.windll.user32.PostMessageW(self.hwnd, self.WM_CLOSE, 0, 0)
        if self._thread and self._thread.is_alive() and threading.current_thread() is not self._thread:
            self._thread.join(timeout=2)
        self.available = False
        self._thread = None

    def process_pending_actions(self) -> None:
        try:
            while True:
                action = self._actions.get_nowait()
                if action == "show":
                    self.on_show()
                elif action == "run":
                    self.on_run()
                elif action == "exit":
                    self.on_exit()
        except queue.Empty:
            pass

    def _message_loop(self) -> None:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        window_proc_type = ctypes.WINFUNCTYPE(
            ctypes.c_ssize_t,
            wintypes.HWND,
            wintypes.UINT,
            wintypes.WPARAM,
            wintypes.LPARAM,
        )
        self._window_proc_callback = window_proc_type(self._window_proc)
        kernel32.GetModuleHandleW.restype = wintypes.HINSTANCE
        self._instance = kernel32.GetModuleHandleW(None)
        user32.RegisterClassW.argtypes = [ctypes.POINTER(_WindowClass)]
        user32.RegisterClassW.restype = wintypes.WORD
        user32.CreateWindowExW.argtypes = [
            wintypes.DWORD,
            wintypes.LPCWSTR,
            wintypes.LPCWSTR,
            wintypes.DWORD,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.HWND,
            wintypes.HANDLE,
            wintypes.HINSTANCE,
            ctypes.c_void_p,
        ]
        user32.CreateWindowExW.restype = wintypes.HWND
        user32.UnregisterClassW.argtypes = [wintypes.LPCWSTR, wintypes.HINSTANCE]
        user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
        user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.DefWindowProcW.restype = ctypes.c_ssize_t
        user32.DestroyWindow.argtypes = [wintypes.HWND]
        user32.IsWindow.argtypes = [wintypes.HWND]
        user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
        window_class = _WindowClass(
            style=0,
            lpfnWndProc=ctypes.cast(self._window_proc_callback, ctypes.c_void_p).value,
            cbClsExtra=0,
            cbWndExtra=0,
            hInstance=self._instance,
            hIcon=None,
            hCursor=None,
            hbrBackground=None,
            lpszMenuName=None,
            lpszClassName=self._class_name,
        )
        try:
            if not user32.RegisterClassW(ctypes.byref(window_class)):
                return
            self.hwnd = user32.CreateWindowExW(
                0,
                self._class_name,
                "SVNmate Tray Host",
                0,
                0,
                0,
                0,
                0,
                None,
                None,
                self._instance,
                None,
            )
            if not self.hwnd or not self._add_icon():
                return
            self.available = True
            self._ready_event.set()
            message = wintypes.MSG()
            while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
                user32.TranslateMessage(ctypes.byref(message))
                user32.DispatchMessageW(ctypes.byref(message))
        finally:
            self._remove_icon()
            if self.hwnd and user32.IsWindow(self.hwnd):
                user32.DestroyWindow(self.hwnd)
            if self._instance:
                user32.UnregisterClassW(self._class_name, self._instance)
            self.available = False
            self.hwnd = 0
            self._window_proc_callback = None
            self._ready_event.set()

    def _add_icon(self) -> bool:
        user32 = ctypes.windll.user32
        shell32 = ctypes.windll.shell32
        user32.LoadImageW.argtypes = [
            wintypes.HINSTANCE,
            wintypes.LPCWSTR,
            wintypes.UINT,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.UINT,
        ]
        shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(_NotifyIconData)]
        width = user32.GetSystemMetrics(49) or 16
        height = user32.GetSystemMetrics(50) or 16
        user32.LoadImageW.restype = wintypes.HICON
        self.icon_handle = user32.LoadImageW(
            None,
            str(self.icon_path),
            self.IMAGE_ICON,
            width,
            height,
            self.LR_LOADFROMFILE,
        )
        if self.icon_handle:
            self.owns_icon = True
        else:
            user32.LoadIconW.restype = wintypes.HICON
            self.icon_handle = user32.LoadIconW(None, ctypes.c_void_p(32512))
        data = _NotifyIconData()
        data.cbSize = ctypes.sizeof(_NotifyIconData)
        data.hWnd = self.hwnd
        data.uID = 1
        data.uFlags = self.NIF_MESSAGE | self.NIF_ICON | self.NIF_TIP
        data.uCallbackMessage = self.WM_TRAYICON
        data.hIcon = self.icon_handle
        data.szTip = "SVNmate - 一键更新 SVN"
        self._notify_data = data
        return bool(shell32.Shell_NotifyIconW(self.NIM_ADD, ctypes.byref(data)))

    def _remove_icon(self) -> None:
        if self._notify_data is not None:
            ctypes.windll.shell32.Shell_NotifyIconW(self.NIM_DELETE, ctypes.byref(self._notify_data))
            self._notify_data = None
        if self.owns_icon and self.icon_handle:
            ctypes.windll.user32.DestroyIcon(self.icon_handle)
        self.icon_handle = 0
        self.owns_icon = False

    def _window_proc(self, hwnd: int, message: int, wparam: int, lparam: int) -> int:
        if message == self.WM_TRAYICON:
            event = int(lparam) & 0xFFFF
            if event == self.WM_LBUTTONDBLCLK:
                self._actions.put("show")
                return 0
            if event in {self.WM_RBUTTONUP, self.WM_CONTEXTMENU}:
                self._show_context_menu()
                return 0
        if message == self.WM_CLOSE:
            ctypes.windll.user32.DestroyWindow(hwnd)
            return 0
        if message == self.WM_DESTROY:
            self._remove_icon()
            ctypes.windll.user32.PostQuitMessage(0)
            return 0
        return ctypes.windll.user32.DefWindowProcW(hwnd, message, wparam, lparam)

    def _show_context_menu(self) -> None:
        user32 = ctypes.windll.user32
        user32.CreatePopupMenu.restype = wintypes.HANDLE
        user32.AppendMenuW.argtypes = [wintypes.HANDLE, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
        user32.TrackPopupMenu.argtypes = [
            wintypes.HANDLE,
            wintypes.UINT,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.HWND,
            ctypes.c_void_p,
        ]
        menu = user32.CreatePopupMenu()
        if not menu:
            return
        user32.AppendMenuW(menu, 0x0000, self.ID_SHOW, "打开 SVNmate")
        user32.AppendMenuW(menu, 0x0000, self.ID_RUN, "立即执行")
        user32.AppendMenuW(menu, 0x0800, 0, None)
        user32.AppendMenuW(menu, 0x0000, self.ID_EXIT, "退出")
        point = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(point))
        user32.SetForegroundWindow(self.hwnd)
        command = user32.TrackPopupMenu(
            menu,
            0x0100 | 0x0002,
            point.x,
            point.y,
            0,
            self.hwnd,
            None,
        )
        user32.DestroyMenu(menu)
        if command == self.ID_SHOW:
            self._actions.put("show")
        elif command == self.ID_RUN:
            self._actions.put("run")
        elif command == self.ID_EXIT:
            self._actions.put("exit")


class SvnAutoTool:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.current_dpi = _configure_tk_dpi(self.root)
        self.root.title("P6-文案小组SVN懒人更新工具")
        self._set_initial_window_geometry(self.current_dpi)
        if APP_ICON_PATH.is_file():
            try:
                self.root.iconbitmap(default=str(APP_ICON_PATH))
            except Exception:
                pass

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
        detected_kindle_status = self._find_default_kindle_status_executable()
        self.launch_kindle_status_on_startup = BooleanVar(value=detected_kindle_status is not None)
        self.kindle_status_path = StringVar(value=str(detected_kindle_status or ""))
        self.kindle_status_path_text = StringVar(value="未选择程序")
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
        self.tray_icon = WindowsTrayIcon(
            self.root,
            self._show_from_tray,
            self._run_from_tray,
            self._exit_application,
            APP_ICON_PATH,
        )

        self._cleanup_old_logs()
        self._build_ui()
        self._load_config()
        self._refresh_kindle_status_path_text()
        self._refresh_music_button()
        self._apply_music_setting()
        self._theme_tick()
        self._refresh_folder_list()
        self._refresh_next_run_text()
        self._poll_log_queue()
        self._poll_tray_actions()
        self._schedule_tick()
        self.root.after(1000, self._dpi_tick)
        self.root.after(200, self._start_tray_icon)
        self.root.after(800, self._launch_kindle_status_at_startup)
        self.root.after(2000, self._check_for_updates_async)
        self.root.after(500, self._finalize_initial_dpi)

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _set_initial_window_geometry(self, dpi: int) -> None:
        dpi_scale = dpi / 96.0
        available_width = max(640, self.root.winfo_screenwidth() - 48)
        available_height = max(480, self.root.winfo_screenheight() - 80)
        window_width = min(round(1140 * dpi_scale), available_width)
        window_height = min(round(760 * dpi_scale), available_height)
        minimum_width = min(round(1000 * dpi_scale), window_width)
        minimum_height = min(round(650 * dpi_scale), window_height)
        self.root.geometry(f"{window_width}x{window_height}")
        self.root.minsize(minimum_width, minimum_height)

    def _finalize_initial_dpi(self) -> None:
        dpi = _get_window_dpi(self.root)
        self.current_dpi = dpi
        self.root.tk.call("tk", "scaling", dpi / 72.0)
        self._set_initial_window_geometry(dpi)
        self._apply_visual_theme(self.current_theme)

    def _build_ui(self) -> None:
        self.ui_style = ttk.Style()
        try:
            self.ui_style.theme_use("clam")
        except Exception:
            pass

        main = ttk.Frame(self.root, style="App.TFrame", padding=(18, 14, 18, 10))
        main.pack(fill=BOTH, expand=True)

        header = ttk.Frame(main, style="App.TFrame")
        header.pack(fill=X)
        title_block = ttk.Frame(header, style="App.TFrame")
        title_block.pack(side=LEFT)
        ttk.Label(title_block, text="SVNmate", style="Title.TLabel").pack(anchor="w")
        ttk.Label(title_block, text="P6 文案小组 · SVN 工作区自动化", style="Subtitle.TLabel").pack(anchor="w")

        header_actions = ttk.Frame(header, style="App.TFrame")
        header_actions.pack(side=RIGHT)
        ttk.Label(header_actions, textvariable=self.status_text, style="Status.TLabel").pack(side=LEFT, padx=(0, 10))
        self.music_button = ttk.Checkbutton(
            header_actions,
            text="音乐开",
            variable=self.music_enabled,
            command=self._on_music_toggle,
            style="Header.TCheckbutton",
        )
        self.music_button.pack(side=LEFT, padx=(0, 8))
        ttk.Button(
            header_actions,
            text="隐藏到托盘",
            style="Subtle.TButton",
            command=self._hide_to_tray,
        ).pack(side=LEFT, padx=(0, 8))
        self.run_button = ttk.Button(header_actions, text="立即执行", style="Accent.TButton", command=self._run_now)
        self.run_button.pack(side=LEFT)

        folder_frame = ttk.Frame(main, style="Card.TFrame", padding=(12, 9))
        folder_frame.pack(fill=BOTH, expand=False, pady=(12, 6))
        folder_title = ttk.Frame(folder_frame, style="Card.TFrame")
        folder_title.pack(fill=X, pady=(0, 7))
        ttk.Label(folder_title, text="工作目录", style="SectionTitle.TLabel").pack(side=LEFT)
        ttk.Label(folder_title, text="仅执行已勾选项目，按列表顺序串行处理", style="CardMuted.TLabel").pack(
            side=LEFT,
            padx=(10, 0),
        )
        columns_frame = ttk.Frame(folder_frame, style="Card.TFrame")
        columns_frame.pack(fill=BOTH, expand=True)
        self._build_folder_column(columns_frame, "left", "栏目一")
        self._build_folder_column(columns_frame, "right", "栏目二")

        settings = ttk.Frame(main, style="App.TFrame")
        settings.pack(fill=X, pady=(0, 6))

        options = ttk.Frame(settings, style="Card.TFrame", padding=(12, 8))
        options.pack(side=LEFT, fill=BOTH, expand=True, padx=(0, 5))
        ttk.Label(options, text="执行选项", style="SectionTitle.TLabel").pack(anchor="w", pady=(0, 5))
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
            pady=(4, 0),
        )
        ttk.Label(options, text="脚本位置留空时使用默认规则；Update 后仍会执行 Cleanup。", style="CardMuted.TLabel").pack(
            anchor="w",
            pady=(5, 0),
        )

        automation = ttk.Frame(settings, style="Card.TFrame", padding=(12, 8))
        automation.pack(side=LEFT, fill=BOTH, expand=True, padx=(5, 0))
        ttk.Label(automation, text="自动化", style="SectionTitle.TLabel").pack(anchor="w", pady=(0, 5))

        automation_controls = ttk.Frame(automation, style="Card.TFrame")
        automation_controls.pack(fill=X)
        schedule_controls = ttk.Frame(automation_controls, style="Card.TFrame")
        schedule_controls.pack(side=LEFT)
        ttk.Checkbutton(
            schedule_controls,
            text="每日定时",
            variable=self.enable_schedule,
            command=self._on_schedule_changed,
            style="Card.TCheckbutton",
        ).pack(side=LEFT)
        ttk.Label(schedule_controls, text="时间", style="Card.TLabel").pack(side=LEFT, padx=(8, 4))
        time_entry = ttk.Entry(schedule_controls, width=7, textvariable=self.schedule_time)
        time_entry.pack(side=LEFT)
        time_entry.bind("<FocusOut>", lambda _event: self._on_schedule_changed())
        time_entry.bind("<Return>", lambda _event: self._on_schedule_changed())
        ttk.Separator(automation_controls, orient="vertical").pack(side=LEFT, fill=Y, padx=10)
        companion_controls = ttk.Frame(automation_controls, style="Card.TFrame")
        companion_controls.pack(side=LEFT, fill=X, expand=True)
        ttk.Checkbutton(
            companion_controls,
            text="联动提示板",
            variable=self.launch_kindle_status_on_startup,
            command=self._on_kindle_status_setting_changed,
            style="Card.TCheckbutton",
        ).pack(side=LEFT)
        ttk.Button(
            companion_controls,
            text="选择",
            style="Compact.TButton",
            command=self._choose_kindle_status_path,
        ).pack(side=LEFT, padx=(8, 4))
        ttk.Button(
            companion_controls,
            text="打开",
            style="Compact.TButton",
            command=lambda: self._launch_kindle_status(manual=True),
        ).pack(side=LEFT)

        automation_meta = ttk.Frame(automation, style="Card.TFrame")
        automation_meta.pack(fill=X, pady=(5, 0))
        ttk.Label(automation_meta, text="下次：", style="CardMuted.TLabel").pack(side=LEFT)
        ttk.Label(automation_meta, textvariable=self.next_run_text, style="CardMuted.TLabel").pack(side=LEFT)
        ttk.Label(
            automation_meta,
            textvariable=self.kindle_status_path_text,
            style="CardMuted.TLabel",
            width=30,
            anchor="e",
        ).pack(side=RIGHT, fill=X, expand=True, padx=(10, 0))

        live_header = ttk.Frame(main, style="App.TFrame")
        live_header.pack(fill=X, pady=(2, 6))
        ttk.Label(live_header, text="实时输出", style="SectionTitleApp.TLabel").pack(side=LEFT)
        ttk.Button(live_header, text="使用指南", style="Subtle.TButton", command=self._open_user_guide).pack(side=RIGHT)
        ttk.Button(live_header, text="日志文件夹", style="Subtle.TButton", command=self._open_log_folder).pack(
            side=RIGHT,
            padx=(0, 6),
        )
        ttk.Button(live_header, text="保存配置", style="Subtle.TButton", command=self._save_config).pack(
            side=RIGHT,
            padx=(0, 6),
        )

        live_frame = ttk.Frame(main, style="Card.TFrame", padding=1)
        live_frame.pack(fill=BOTH, expand=True, pady=(0, 16))
        self.live_log = ttk.Treeview(live_frame, columns=("line",), show="headings", height=11)
        self.live_log.configure(style="LiveLog.Treeview")
        self.live_log.heading("line", text="日志")
        self.live_log.column("line", width=880, anchor="w")
        log_scroll = ttk.Scrollbar(live_frame, orient="vertical", command=self.live_log.yview)
        self.live_log.configure(yscrollcommand=log_scroll.set)
        self.live_log.pack(side=LEFT, fill=BOTH, expand=True)
        log_scroll.pack(side=RIGHT, fill=Y)

        self.update_dot = ttk.Label(main, text="○", style="UpdateDot.TLabel", cursor="hand2")
        self.update_dot.place(relx=1.0, rely=1.0, x=-90, y=-3, anchor="se")
        self.update_dot.bind("<Button-1>", lambda _event: self._on_update_dot_clicked())
        self.signature_label = ttk.Label(main, text="SusamMinami", style="Signature.TLabel")
        self.signature_label.place(relx=1.0, rely=1.0, x=-6, y=-2, anchor="se")

    def _build_folder_column(self, parent: ttk.Frame, group_key: str, title: str) -> None:
        column = ttk.Frame(parent, style="Card.TFrame")
        column.pack(side=LEFT, fill=BOTH, expand=True, padx=(0, 6) if group_key == "left" else (6, 0))

        toolbar = ttk.Frame(column, style="Card.TFrame")
        toolbar.pack(fill=X, pady=(0, 5))
        ttk.Label(toolbar, text=title, style="CardTitle.TLabel").pack(side=LEFT)
        ttk.Button(toolbar, text="清空", style="Compact.TButton", command=lambda: self._clear_folders(group_key)).pack(
            side=RIGHT,
        )
        ttk.Button(
            toolbar,
            text="移除",
            style="Compact.TButton",
            command=lambda: self._remove_selected_folder(group_key),
        ).pack(side=RIGHT, padx=(0, 5))
        ttk.Button(
            toolbar,
            text="+ 添加文件夹",
            style="Compact.TButton",
            command=lambda: self._add_folder(group_key),
        ).pack(side=RIGHT, padx=(0, 5))

        tree_frame = ttk.Frame(column, style="Card.TFrame")
        tree_frame.pack(fill=BOTH, expand=True)
        tree = ttk.Treeview(tree_frame, columns=("enabled", "path"), show="headings", height=6)
        tree.heading("enabled", text="执行")
        tree.heading("path", text="文件夹路径")
        tree.column("enabled", width=52, anchor="center", stretch=False)
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
        row = ttk.Frame(parent, style="Card.TFrame")
        row.pack(fill=X, pady=pady)
        ttk.Checkbutton(
            row,
            text=text,
            variable=variable,
            command=self._save_config,
            style="Card.TCheckbutton",
        ).pack(side=LEFT, anchor="w")
        ttk.Button(row, text="默认", style="Compact.TButton", command=clear_command).pack(side=RIGHT)
        ttk.Button(row, text=choose_text, style="Compact.TButton", command=choose_command).pack(
            side=RIGHT,
            padx=(0, 5),
        )

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
        detected_path = self.kindle_status_path.get()
        self.kindle_status_path.set(str(data.get("kindle_status_path", detected_path)))
        self.launch_kindle_status_on_startup.set(
            bool(data.get("launch_kindle_status_on_startup", bool(detected_path)))
        )
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
            "launch_kindle_status_on_startup": self.launch_kindle_status_on_startup.get(),
            "kindle_status_path": self.kindle_status_path.get().strip(),
            "enable_schedule": self.enable_schedule.get(),
            "schedule_time": self.schedule_time.get().strip(),
            "last_bin_update_date": self.last_bin_update_date,
        }
        CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        self._refresh_next_run_text()
        self._refresh_kindle_status_path_text()

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

    @staticmethod
    def _find_default_kindle_status_executable() -> Path | None:
        downloads = Path.home() / "Downloads"
        candidates = [
            APP_DIR / KINDLE_STATUS_EXE_NAME,
            APP_DIR / "KindleLarkStatus" / "dist" / KINDLE_STATUS_EXE_NAME,
            APP_DIR.parent / "KindleLarkStatus" / "dist" / KINDLE_STATUS_EXE_NAME,
            APP_DIR.parent / "提示板" / "KindleLarkStatus" / "dist" / KINDLE_STATUS_EXE_NAME,
            downloads / "提示板" / "KindleLarkStatus" / "dist" / KINDLE_STATUS_EXE_NAME,
        ]
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        return None

    def _resolve_kindle_status_executable(self) -> Path | None:
        path_text = self.kindle_status_path.get().strip()
        if not path_text:
            return None
        path = Path(path_text).expanduser()
        candidates = [path]
        if path.is_dir():
            candidates = [
                path / KINDLE_STATUS_EXE_NAME,
                path / "dist" / KINDLE_STATUS_EXE_NAME,
                path / "dist" / "windows" / KINDLE_STATUS_EXE_NAME,
            ]
        for candidate in candidates:
            if candidate.is_file():
                return candidate.resolve()
        return None

    def _refresh_kindle_status_path_text(self) -> None:
        executable = self._resolve_kindle_status_executable()
        if executable is None:
            self.kindle_status_path_text.set("未选择或路径不可用")
            return
        path_text = str(executable)
        if len(path_text) > 44:
            path_text = "..." + path_text[-41:]
        self.kindle_status_path_text.set(path_text)

    def _on_kindle_status_setting_changed(self) -> None:
        self._save_config()

    def _choose_kindle_status_path(self) -> None:
        executable = self._resolve_kindle_status_executable()
        initial_dir = executable.parent if executable else Path.home() / "Downloads"
        file_path = filedialog.askopenfilename(
            title="选择 Kindle 提示板程序",
            initialdir=str(initial_dir),
            filetypes=(("KindleLarkStatus", "KindleLarkStatus*.exe"), ("可执行程序", "*.exe"), ("所有文件", "*.*")),
        )
        if not file_path:
            return
        self.kindle_status_path.set(str(Path(file_path)))
        self.launch_kindle_status_on_startup.set(True)
        self._save_config()

    def _launch_kindle_status_at_startup(self) -> None:
        if self.launch_kindle_status_on_startup.get():
            self._launch_kindle_status(manual=False)

    def _launch_kindle_status(self, manual: bool) -> None:
        executable = self._resolve_kindle_status_executable()
        if executable is None:
            message = "未找到 Kindle 提示板程序，请重新选择 KindleLarkStatus.exe。"
            self._log(message)
            if manual:
                messagebox.showwarning("无法打开提示板", message)
            return
        if self._is_process_running(executable.name):
            self._log("Kindle 提示板已在运行，已跳过重复启动。")
            if manual:
                messagebox.showinfo("Kindle 提示板", "Kindle 提示板已经在运行。")
            return
        creation_flags = 0
        if os.name == "nt":
            creation_flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        try:
            subprocess.Popen(
                [str(executable)],
                cwd=str(executable.parent),
                creationflags=creation_flags,
                close_fds=True,
            )
        except OSError as exc:
            self._log(f"Kindle 提示板启动失败：{exc}")
            if manual:
                messagebox.showerror("提示板启动失败", str(exc))
            return
        self._log(f"已联动启动 Kindle 提示板：{executable}")

    @staticmethod
    def _is_process_running(executable_name: str) -> bool:
        if os.name != "nt":
            return False
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"IMAGENAME eq {executable_name}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return False
        return executable_name.casefold() in result.stdout.casefold()

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

    def _dpi_tick(self) -> None:
        if os.name == "nt":
            dpi = _get_window_dpi(self.root)
            if dpi > 0 and dpi != self.current_dpi:
                self.current_dpi = dpi
                self.root.tk.call("tk", "scaling", dpi / 72.0)
                self._apply_visual_theme(self.current_theme)
        self.root.after(1000, self._dpi_tick)

    @staticmethod
    def _is_night_time() -> bool:
        hour = datetime.now().hour
        return hour >= 19 or hour < 6

    def _apply_visual_theme(self, theme: str) -> None:
        try:
            self.ui_style.theme_use("clam")
        except Exception:
            pass
        if theme == "night":
            colors = {
                "bg": "#202020",
                "card": "#2B2B2B",
                "text": "#FFFFFF",
                "muted": "#C8C8C8",
                "accent": "#60CDFF",
                "accent_fill": "#0078D4",
                "accent_hover": "#1686D9",
                "accent_pressed": "#0067B8",
                "border": "#454545",
                "button": "#383838",
                "button_active": "#454545",
                "button_pressed": "#303030",
                "entry": "#353535",
                "entry_focus": "#3D3D3D",
                "tree": "#252525",
                "tree_text": "#F7F7F7",
                "heading": "#333333",
                "heading_text": "#FFFFFF",
                "selected": "#005A9E",
                "selected_text": "#FFFFFF",
                "completed": "#244B32",
                "completed_text": "#F3FFF6",
                "scrollbar": "#666666",
                "scroll_trough": "#2B2B2B",
                "disabled": "#777777",
            }
        else:
            colors = {
                "bg": "#F3F3F3",
                "card": "#FFFFFF",
                "text": "#1A1A1A",
                "muted": "#666666",
                "accent": "#0067C0",
                "accent_fill": "#0067C0",
                "accent_hover": "#1976D2",
                "accent_pressed": "#005A9E",
                "border": "#D1D1D1",
                "button": "#F7F7F7",
                "button_active": "#E9E9E9",
                "button_pressed": "#DDDDDD",
                "entry": "#FFFFFF",
                "entry_focus": "#FFFFFF",
                "tree": "#FFFFFF",
                "tree_text": "#1A1A1A",
                "heading": "#F5F5F5",
                "heading_text": "#333333",
                "selected": "#0078D4",
                "selected_text": "#FFFFFF",
                "completed": "#DFF6DD",
                "completed_text": "#153B1B",
                "scrollbar": "#B8B8B8",
                "scroll_trough": "#F3F3F3",
                "disabled": "#9A9A9A",
            }

        self.root.configure(bg=colors["bg"])
        self.ui_style.configure(".", font=("Segoe UI", 10), background=colors["card"], foreground=colors["text"])
        self.ui_style.configure("TFrame", background=colors["card"])
        self.ui_style.configure("App.TFrame", background=colors["bg"])
        self.ui_style.configure("Card.TFrame", background=colors["card"])
        self.ui_style.configure("TLabel", background=colors["card"], foreground=colors["text"])
        self.ui_style.configure("Card.TLabel", background=colors["card"], foreground=colors["text"])
        self.ui_style.configure(
            "Title.TLabel",
            background=colors["bg"],
            foreground=colors["text"],
            font=("Segoe UI Semibold", 22),
        )
        self.ui_style.configure(
            "Subtitle.TLabel",
            background=colors["bg"],
            foreground=colors["muted"],
            font=("Segoe UI", 9),
        )
        self.ui_style.configure(
            "SectionTitle.TLabel",
            background=colors["card"],
            foreground=colors["text"],
            font=("Segoe UI Semibold", 11),
        )
        self.ui_style.configure(
            "SectionTitleApp.TLabel",
            background=colors["bg"],
            foreground=colors["text"],
            font=("Segoe UI Semibold", 11),
        )
        self.ui_style.configure(
            "CardTitle.TLabel",
            background=colors["card"],
            foreground=colors["accent"],
            font=("Segoe UI Semibold", 10),
        )
        self.ui_style.configure(
            "CardMuted.TLabel",
            background=colors["card"],
            foreground=colors["muted"],
            font=("Segoe UI", 9),
        )
        self.ui_style.configure(
            "Status.TLabel",
            background=colors["bg"],
            foreground=colors["accent"],
            font=("Segoe UI Semibold", 10),
            padding=(8, 5),
        )
        self.ui_style.configure("TCheckbutton", background=colors["card"], foreground=colors["text"])
        self.ui_style.configure("Card.TCheckbutton", background=colors["card"], foreground=colors["text"])
        self.ui_style.configure("Header.TCheckbutton", background=colors["bg"], foreground=colors["text"])
        for style_name, background in (("TCheckbutton", colors["card"]), ("Card.TCheckbutton", colors["card"]), ("Header.TCheckbutton", colors["bg"])):
            self.ui_style.map(
                style_name,
                background=[("active", background), ("pressed", background)],
                foreground=[("disabled", colors["disabled"])],
            )
        self.ui_style.configure(
            "TButton",
            background=colors["button"],
            foreground=colors["text"],
            bordercolor=colors["border"],
            lightcolor=colors["button"],
            darkcolor=colors["button"],
            relief="flat",
            borderwidth=1,
            padding=(10, 5),
            font=("Segoe UI", 9),
        )
        self.ui_style.map(
            "TButton",
            background=[
                ("disabled", colors["card"]),
                ("pressed", colors["button_pressed"]),
                ("active", colors["button_active"]),
            ],
            foreground=[("disabled", colors["disabled"])],
        )
        self.ui_style.configure(
            "Accent.TButton",
            background=colors["accent_fill"],
            foreground="#FFFFFF",
            bordercolor=colors["accent_fill"],
            lightcolor=colors["accent_fill"],
            darkcolor=colors["accent_fill"],
            relief="flat",
            borderwidth=1,
            padding=(18, 8),
            font=("Segoe UI Semibold", 10),
        )
        self.ui_style.map(
            "Accent.TButton",
            background=[
                ("disabled", colors["disabled"]),
                ("pressed", colors["accent_pressed"]),
                ("active", colors["accent_hover"]),
            ],
            foreground=[("disabled", colors["card"])],
        )
        self.ui_style.configure(
            "Subtle.TButton",
            background=colors["bg"],
            foreground=colors["text"],
            bordercolor=colors["bg"],
            lightcolor=colors["bg"],
            darkcolor=colors["bg"],
            relief="flat",
            padding=(9, 5),
        )
        self.ui_style.map(
            "Subtle.TButton",
            background=[("pressed", colors["button_pressed"]), ("active", colors["button_active"])],
            foreground=[("disabled", colors["disabled"])],
        )
        self.ui_style.configure(
            "Compact.TButton",
            background=colors["button"],
            foreground=colors["text"],
            bordercolor=colors["border"],
            lightcolor=colors["button"],
            darkcolor=colors["button"],
            relief="flat",
            padding=(8, 3),
            font=("Segoe UI", 9),
        )
        self.ui_style.map(
            "Compact.TButton",
            background=[("pressed", colors["button_pressed"]), ("active", colors["button_active"])],
            foreground=[("disabled", colors["disabled"])],
        )
        self.ui_style.configure(
            "TEntry",
            fieldbackground=colors["entry"],
            foreground=colors["text"],
            bordercolor=colors["border"],
            lightcolor=colors["border"],
            darkcolor=colors["border"],
            padding=(5, 4),
        )
        self.ui_style.map(
            "TEntry",
            fieldbackground=[
                ("disabled", colors["card"]),
                ("focus", colors["entry_focus"]),
            ],
            foreground=[("disabled", colors["disabled"])],
        )
        self.ui_style.configure(
            "Treeview",
            background=colors["tree"],
            fieldbackground=colors["tree"],
            foreground=colors["tree_text"],
            bordercolor=colors["border"],
            lightcolor=colors["border"],
            darkcolor=colors["border"],
            borderwidth=0,
            rowheight=25,
            font=("Segoe UI", 9),
        )
        self.ui_style.map(
            "Treeview",
            background=[("selected", colors["selected"])],
            foreground=[("selected", colors["selected_text"])],
        )
        self.ui_style.configure(
            "Treeview.Heading",
            background=colors["heading"],
            foreground=colors["heading_text"],
            bordercolor=colors["border"],
            lightcolor=colors["border"],
            darkcolor=colors["border"],
            relief="flat",
            font=("Segoe UI Semibold", 9),
            padding=(6, 5),
        )
        self.ui_style.map("Treeview.Heading", background=[("active", colors["button_active"])])
        self.ui_style.configure(
            "TScrollbar",
            background=colors["scrollbar"],
            troughcolor=colors["scroll_trough"],
            bordercolor=colors["border"],
            lightcolor=colors["scrollbar"],
            darkcolor=colors["border"],
            arrowcolor=colors["text"],
        )
        self.ui_style.configure("TSeparator", background=colors["border"])
        self.ui_style.configure(
            "Signature.TLabel",
            background=colors["bg"],
            foreground=colors["muted"],
            font=("Segoe UI", 9, "italic"),
        )
        self.ui_style.configure(
            "UpdateDot.TLabel",
            background=colors["bg"],
            foreground=colors["muted"],
            font=("Segoe UI", 11, "bold"),
        )
        self.ui_style.configure(
            "UpdateDotReady.TLabel",
            background=colors["bg"],
            foreground="#D93636",
            font=("Segoe UI", 11, "bold"),
        )
        self.ui_style.configure("LiveLog.Treeview", background=colors["tree"], fieldbackground=colors["tree"], foreground=colors["tree_text"])
        self.ui_style.configure(
            "Completed.LiveLog.Treeview",
            background=colors["completed"],
            fieldbackground=colors["completed"],
            foreground=colors["completed_text"],
        )
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
        launch_command = self._windows_cmd_command_line(command)
        process = subprocess.Popen(
            launch_command,
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

    @staticmethod
    def _windows_cmd_command_line(command: list[str]) -> list[str] | str:
        if os.name != "nt" or not command:
            return command
        executable_name = Path(command[0]).name.lower()
        normalized = [part.lower() for part in command]
        if executable_name not in {"cmd", "cmd.exe"} or "/c" not in normalized:
            return command
        body_index = normalized.index("/c") + 1
        if body_index != len(command) - 1:
            return command

        # list2cmdline escapes body quotes as \", which cmd.exe treats literally.
        prefix = subprocess.list2cmdline(command[:body_index])
        return f'{prefix} "{command[body_index]}"'

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

    def _start_tray_icon(self) -> None:
        if not self.tray_icon.start():
            self._log("系统托盘图标初始化失败，关闭窗口时将直接退出。")

    def _poll_tray_actions(self) -> None:
        self.tray_icon.process_pending_actions()
        self.root.after(100, self._poll_tray_actions)

    def _hide_to_tray(self) -> None:
        if not self.tray_icon.available:
            self._exit_application()
            return
        self.root.withdraw()

    def _show_from_tray(self) -> None:
        self.root.deiconify()
        self.root.state("normal")
        self.root.lift()
        self.root.after(80, self.root.focus_force)

    def _run_from_tray(self) -> None:
        self._show_from_tray()
        self.root.after(100, self._run_now)

    def _exit_application(self) -> None:
        if self.running:
            self._show_from_tray()
            if not messagebox.askyesno("任务仍在执行", "任务还在执行中，确定要退出工具吗？"):
                return
        self._save_config()
        self._stop_music()
        self.tray_icon.stop()
        self.root.destroy()

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
        self.tray_icon.stop()
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
        if self.tray_icon.available:
            self._hide_to_tray()
        else:
            self._exit_application()


def main() -> None:
    root = Tk()
    try:
        ttk.Style().theme_use("clam")
    except Exception:
        pass
    SvnAutoTool(root)
    root.mainloop()


if __name__ == "__main__":
    main()
