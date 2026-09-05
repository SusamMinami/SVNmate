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
from collections import deque
from collections.abc import Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from module_updates import ModuleManifest, ModuleUpdateError, download_archive
from svnmate_theme import configure_svnmate_styles
from svnmate_core import (
    CommandExecution,
    UpdateEvent,
    WorkspaceUpdateService,
    needs_svn_cleanup,
)
from svnmate_ipc import IPC_PROTOCOL_VERSION, SvnMateIpcServer
from tool_modules import (
    CONFIG_LINKER,
    KINDLE_STATUS,
    MIGRATION_GUARD,
    TOOL_MODULES,
    ToolModuleManager,
    ToolModuleSpec,
    module_paths_from_config,
)


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

from tkinter import BOTH, END, LEFT, RIGHT, X, Y, BooleanVar, Label, Menu, StringVar, Tk, Toplevel, filedialog, messagebox
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


def _window_dimensions_for_dpi(
    dpi: int,
    screen_width: int,
    screen_height: int,
) -> tuple[int, int, int, int]:
    dpi_scale = max(96, dpi) / 96.0
    available_width = max(640, screen_width - 48)
    available_height = max(480, screen_height - 80)
    width = min(round(1140 * dpi_scale), available_width)
    height = min(round(760 * dpi_scale), available_height)
    minimum_width = min(round(1000 * dpi_scale), width)
    minimum_height = min(round(650 * dpi_scale), height)
    return width, height, minimum_width, minimum_height


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
APP_VERSION = "v1.4.5"
LATEST_RELEASE_URL = "https://github.com/SusamMinami/SVNmate/releases/latest"
RELEASE_DOWNLOAD_URL = "https://github.com/SusamMinami/SVNmate/releases/download/{tag}/{asset}"
RELEASE_ASSET_NAME = "SVNmate.zip"
KINDLE_STATUS_EXE_NAME = "KindleLarkStatus.exe"
APP_ICON_PATH = RESOURCE_DIR / "svnmate.ico"
APP_WINDOW_TITLE = "P6-文案小组SVN懒人更新工具"
TRAY_WINDOW_TITLE = "SVNmate Tray Host"
TRAY_WINDOW_CLASS_NAME = "SVNmate.SingleInstance.TrayWindow.v1"
SINGLE_INSTANCE_MUTEX_NAME = r"Local\SVNmate.SingleInstance"
ACTIVATE_INSTANCE_MESSAGE_NAME = "SVNmate.ActivateExistingInstance.v1"
MAX_PENDING_LOG_ITEMS = 500
MAX_LIVE_LOG_ROWS = 300
MAX_LIVE_LOG_CHARS = 12000
TRAY_ACTION_POLL_MS = 250
LOG_ACTIVE_POLL_MS = 200
LOG_IDLE_POLL_MS = 1000
SCHEDULE_POLL_MS = 5000
DPI_VISIBLE_POLL_MS = 1000
DPI_HIDDEN_POLL_MS = 10000
IPC_REQUEST_TIMEOUT_SECONDS = 6 * 60 * 60
ICON_MUSIC_ON = "\ue767"
ICON_MUSIC_OFF = "\ue74f"
ICON_HIDE_TO_TRAY = "\ue921"
ICON_MORE = "\ue712"


@dataclass(frozen=True)
class TaskRunSummary:
    trigger: str
    succeeded: int
    failed: int
    skipped: int

    @property
    def status_text(self) -> str:
        if not self.succeeded and not self.failed and not self.skipped:
            return "未产生结果"
        if self.failed:
            return "部分完成" if self.succeeded or self.skipped else "执行失败"
        if self.skipped:
            return "已完成（有跳过）"
        return "已完成"

    @property
    def detail_text(self) -> str:
        if not self.succeeded and not self.failed and not self.skipped:
            return "完成 · 无可统计步骤"
        return (
            f"{self.status_text} · 步骤：成功 {self.succeeded} · "
            f"失败 {self.failed} · 跳过 {self.skipped}"
        )

    @property
    def tone(self) -> str:
        if not self.succeeded and not self.failed and not self.skipped:
            return "warning"
        if self.failed:
            return "warning" if self.succeeded or self.skipped else "error"
        if self.skipped:
            return "warning"
        return "success"


class ToolTip:
    def __init__(self, widget: object, text: str) -> None:
        self.widget = widget
        self.text = text
        self.window: Toplevel | None = None
        widget.bind("<Enter>", self._show, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<FocusIn>", self._show, add="+")
        widget.bind("<FocusOut>", self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def set_text(self, text: str) -> None:
        self.text = text
        if self.window is not None:
            self._hide()

    def _show(self, _event: object = None) -> None:
        if self.window is not None or not self.text:
            return
        self.window = Toplevel(self.widget)
        self.window.wm_overrideredirect(True)
        self.window.attributes("-topmost", True)
        x = min(
            self.widget.winfo_rootx(),
            self.widget.winfo_screenwidth() - 340,
        )
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 5
        self.window.wm_geometry(f"+{max(0, x)}+{max(0, y)}")
        Label(
            self.window,
            text=self.text,
            background="#202020",
            foreground="#FFFFFF",
            padx=8,
            pady=5,
            font=("Segoe UI", 9),
            relief="solid",
            borderwidth=1,
        ).pack()

    def _hide(self, _event: object = None) -> None:
        if self.window is None:
            return
        self.window.destroy()
        self.window = None


def tool_module_primary_label(
    spec: ToolModuleSpec,
    *,
    installed: bool,
    state: str,
) -> str:
    if state in {"checking", "downloading"}:
        return "处理中"
    if state == "ready":
        return "更新" if installed else "安装"
    if installed:
        return "打开"
    return "安装" if spec.supports_updates else "选择"


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


class SingleInstanceGuard:
    ERROR_ALREADY_EXISTS = 183
    HWND_BROADCAST = 0xFFFF
    MB_OK = 0x00000000
    MB_ICONINFORMATION = 0x00000040
    MB_SETFOREGROUND = 0x00010000

    def __init__(self) -> None:
        self.handle = 0
        self.is_primary = True
        if os.name != "nt":
            return
        kernel32 = ctypes.windll.kernel32
        kernel32.CreateMutexW.argtypes = [
            ctypes.c_void_p,
            wintypes.BOOL,
            wintypes.LPCWSTR,
        ]
        kernel32.CreateMutexW.restype = wintypes.HANDLE
        kernel32.SetLastError(0)
        self.handle = kernel32.CreateMutexW(
            None,
            False,
            SINGLE_INSTANCE_MUTEX_NAME,
        )
        if self.handle:
            self.is_primary = (
                kernel32.GetLastError() != self.ERROR_ALREADY_EXISTS
            )

    def notify_existing_instance(self) -> None:
        if os.name != "nt":
            return
        user32 = ctypes.windll.user32
        user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        user32.FindWindowW.restype = wintypes.HWND
        user32.RegisterWindowMessageW.argtypes = [wintypes.LPCWSTR]
        user32.RegisterWindowMessageW.restype = wintypes.UINT
        user32.PostMessageW.argtypes = [
            wintypes.HWND,
            wintypes.UINT,
            wintypes.WPARAM,
            wintypes.LPARAM,
        ]
        user32.MessageBoxW(
            None,
            "SVNmate 已在后台运行。\n\n点击“确定”后将打开现有窗口。",
            "SVNmate 已在运行",
            self.MB_OK | self.MB_ICONINFORMATION | self.MB_SETFOREGROUND,
        )
        activate_message = user32.RegisterWindowMessageW(
            ACTIVATE_INSTANCE_MESSAGE_NAME
        )
        hwnd = user32.FindWindowW(TRAY_WINDOW_CLASS_NAME, None)
        if hwnd:
            process_id = wintypes.DWORD()
            user32.GetWindowThreadProcessId(
                hwnd,
                ctypes.byref(process_id),
            )
            if process_id.value:
                user32.AllowSetForegroundWindow(process_id.value)
            user32.PostMessageW(hwnd, activate_message, 0, 0)
            return
        user32.PostMessageW(
            self.HWND_BROADCAST,
            activate_message,
            0,
            0,
        )

    def close(self) -> None:
        if os.name == "nt" and self.handle:
            ctypes.windll.kernel32.CloseHandle(self.handle)
            self.handle = 0


class WindowsTrayIcon:
    NIM_ADD = 0
    NIM_MODIFY = 1
    NIM_DELETE = 2
    NIF_MESSAGE = 0x1
    NIF_ICON = 0x2
    NIF_TIP = 0x4
    NIF_INFO = 0x10
    NIIF_INFO = 0x1
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
    ID_MODULE_BASE = 1100
    ID_EXIT = 1200

    def __init__(
        self,
        root: Tk,
        on_show: object,
        on_toggle: object,
        on_run: object,
        on_exit: object,
        module_actions: dict[str, tuple[str, object]],
        icon_path: Path,
    ) -> None:
        self.root = root
        self.on_show = on_show
        self.on_toggle = on_toggle
        self.on_run = on_run
        self.on_exit = on_exit
        self.module_actions = module_actions
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
        self._class_name = TRAY_WINDOW_CLASS_NAME
        self._instance = 0
        self._activate_message = 0
        self._taskbar_created_message = 0
        if os.name == "nt":
            user32 = ctypes.windll.user32
            user32.RegisterWindowMessageW.argtypes = [wintypes.LPCWSTR]
            user32.RegisterWindowMessageW.restype = wintypes.UINT
            self._activate_message = user32.RegisterWindowMessageW(
                ACTIVATE_INSTANCE_MESSAGE_NAME
            )
            self._taskbar_created_message = user32.RegisterWindowMessageW(
                "TaskbarCreated"
            )

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
                elif action == "toggle":
                    self.on_toggle()
                elif action == "run":
                    self.on_run()
                elif action == "exit":
                    self.on_exit()
                elif action in self.module_actions:
                    self.module_actions[action][1]()
        except queue.Empty:
            pass

    def ensure_visible(self) -> bool:
        if os.name != "nt" or not self.hwnd:
            return False
        shell32 = ctypes.windll.shell32
        shell32.Shell_NotifyIconW.argtypes = [
            wintypes.DWORD,
            ctypes.POINTER(_NotifyIconData),
        ]
        if self._notify_data is not None and shell32.Shell_NotifyIconW(
            self.NIM_MODIFY,
            ctypes.byref(self._notify_data),
        ):
            self.available = True
            return True
        self.available = self._add_icon()
        return self.available

    def show_notification(self, title: str, message: str) -> bool:
        if (
            os.name != "nt"
            or not self.available
            or self._notify_data is None
        ):
            return False
        shell32 = ctypes.windll.shell32
        shell32.Shell_NotifyIconW.argtypes = [
            wintypes.DWORD,
            ctypes.POINTER(_NotifyIconData),
        ]
        original_flags = self._notify_data.uFlags
        self._notify_data.uFlags = self.NIF_INFO
        self._notify_data.szInfoTitle = title[:63]
        self._notify_data.szInfo = message[:255]
        self._notify_data.dwInfoFlags = self.NIIF_INFO
        try:
            return bool(
                shell32.Shell_NotifyIconW(
                    self.NIM_MODIFY,
                    ctypes.byref(self._notify_data),
                )
            )
        finally:
            self._notify_data.uFlags = original_flags

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
                TRAY_WINDOW_TITLE,
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
        shell32 = ctypes.windll.shell32
        shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(_NotifyIconData)]
        if self._notify_data is None:
            user32 = ctypes.windll.user32
            user32.LoadImageW.argtypes = [
                wintypes.HINSTANCE,
                wintypes.LPCWSTR,
                wintypes.UINT,
                ctypes.c_int,
                ctypes.c_int,
                wintypes.UINT,
            ]
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
        return bool(
            shell32.Shell_NotifyIconW(
                self.NIM_ADD,
                ctypes.byref(self._notify_data),
            )
        )

    def _remove_icon(self) -> None:
        if self._notify_data is not None:
            ctypes.windll.shell32.Shell_NotifyIconW(self.NIM_DELETE, ctypes.byref(self._notify_data))
            self._notify_data = None
        if self.owns_icon and self.icon_handle:
            ctypes.windll.user32.DestroyIcon(self.icon_handle)
        self.icon_handle = 0
        self.owns_icon = False

    def _window_proc(self, hwnd: int, message: int, wparam: int, lparam: int) -> int:
        if self._activate_message and message == self._activate_message:
            self._actions.put("show")
            return 0
        taskbar_created_message = getattr(
            self,
            "_taskbar_created_message",
            0,
        )
        if taskbar_created_message and message == taskbar_created_message:
            self.available = self._add_icon()
            return 0
        if message == self.WM_TRAYICON:
            event = int(lparam) & 0xFFFF
            if event == self.WM_LBUTTONDBLCLK:
                self._actions.put("toggle")
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
        module_commands: dict[int, str] = {}
        for index, (action, (label, _callback)) in enumerate(
            self.module_actions.items()
        ):
            command_id = self.ID_MODULE_BASE + index
            module_commands[command_id] = action
            user32.AppendMenuW(menu, 0x0000, command_id, label)
        if module_commands:
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
        elif command in module_commands:
            self._actions.put(module_commands[command])


class SvnAutoTool:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.current_dpi = _configure_tk_dpi(self.root)
        self.root.title(APP_WINDOW_TITLE)
        self._set_initial_window_geometry(self.current_dpi)
        if APP_ICON_PATH.is_file():
            try:
                self.root.iconbitmap(default=str(APP_ICON_PATH))
            except Exception:
                pass

        self.folder_groups: dict[str, list[dict[str, object]]] = {"left": [], "right": []}
        self.folder_trees: dict[str, ttk.Treeview] = {}
        self.log_queue: queue.Queue[tuple[str, object]] = queue.Queue(
            maxsize=MAX_PENDING_LOG_ITEMS
        )
        self.dropped_live_log_items = 0
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
        detected_config_linker = self._find_default_config_linker_executable()
        detected_migration_guard = (
            self._find_default_migration_guard_executable()
        )
        detected_kindle_status = self._find_default_kindle_status_executable()
        self.tool_module_manager = ToolModuleManager(
            APP_DIR,
            process_checker=self._is_process_running,
        )
        self.tool_module_paths = {
            CONFIG_LINKER.module_id: StringVar(
                value=str(detected_config_linker or "")
            ),
            MIGRATION_GUARD.module_id: StringVar(
                value=str(detected_migration_guard or "")
            ),
            KINDLE_STATUS.module_id: StringVar(
                value=str(detected_kindle_status or "")
            ),
        }
        self.launch_kindle_status_on_startup = BooleanVar(value=detected_kindle_status is not None)
        self.kindle_status_path = self.tool_module_paths[KINDLE_STATUS.module_id]
        self.tool_module_status = {
            spec.module_id: StringVar(value="未检查")
            for spec in TOOL_MODULES
        }
        self.tool_module_states = {
            spec.module_id: "idle"
            for spec in TOOL_MODULES
        }
        self.tool_module_manifests: dict[str, ModuleManifest] = {}
        self.tool_module_install_after_check: set[str] = set()
        self.tool_module_action_buttons: dict[str, ttk.Button] = {}
        self.tool_module_status_labels: dict[str, ttk.Label] = {}
        self.tool_module_path_tooltips: dict[str, ToolTip] = {}
        self.tooltips: list[ToolTip] = []
        self.schedule_time = StringVar(value="09:00")
        self.next_run_text = StringVar(value="未启用")
        self.status_text = StringVar(value="就绪")
        self.completion_summary_text = StringVar(value="尚未执行")
        self.completion_summary_state = "idle"
        self.run_outcomes: dict[tuple[str, str], str] = {}
        self.run_outcomes_lock = threading.Lock()
        self.music_file = self._find_music_file()
        self.music_alias = f"svnmate_music_{id(self)}"
        self.music_backend = ""
        self.music_fading = False
        self.music_paused_after_task = False
        self.tray_hint_shown = False
        self.update_info: dict[str, str] | None = None
        self.update_state = "checking"
        self.current_theme = ""
        self.tray_icon = WindowsTrayIcon(
            self.root,
            self._show_from_tray,
            self._toggle_from_tray,
            self._run_from_tray,
            self._exit_application,
            {
                spec.module_id: (
                    f"打开{spec.display_name}",
                    lambda current=spec: self._launch_tool_module(
                        current,
                        manual=True,
                    ),
                )
                for spec in TOOL_MODULES
            },
            APP_ICON_PATH,
        )
        self.ipc_server = SvnMateIpcServer(
            self._handle_ipc_request,
            log=self._log,
        )

        self._cleanup_old_logs()
        self._build_ui()
        self._load_config()
        self._refresh_tool_module_rows()
        self._refresh_music_button()
        self._apply_music_setting()
        self._theme_tick()
        self._refresh_folder_list()
        self._refresh_next_run_text()
        self._poll_log_queue()
        self._poll_tray_actions()
        self._schedule_tick()
        self.root.after(DPI_VISIBLE_POLL_MS, self._dpi_tick)
        self.root.after(200, self._start_tray_icon)
        self.root.after(300, self._start_ipc_server)
        self.root.after(800, self._launch_kindle_status_at_startup)
        self.root.after(2000, self._check_for_updates_async)
        self.root.after(2600, self._check_tool_modules_async)
        self.root.after(500, self._finalize_initial_dpi)

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _set_initial_window_geometry(self, dpi: int) -> None:
        (
            window_width,
            window_height,
            minimum_width,
            minimum_height,
        ) = _window_dimensions_for_dpi(
            dpi,
            self.root.winfo_screenwidth(),
            self.root.winfo_screenheight(),
        )
        self.root.geometry(f"{window_width}x{window_height}")
        self.root.minsize(minimum_width, minimum_height)

    def _refresh_window_minimum_size(self, dpi: int) -> None:
        _, _, minimum_width, minimum_height = _window_dimensions_for_dpi(
            dpi,
            self.root.winfo_screenwidth(),
            self.root.winfo_screenheight(),
        )
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
        title_line = ttk.Frame(title_block, style="App.TFrame")
        title_line.pack(anchor="w")
        ttk.Label(title_line, text="SVNmate", style="Title.TLabel").pack(
            side=LEFT
        )
        ttk.Label(
            title_line,
            textvariable=self.status_text,
            width=14,
            anchor="w",
            style="TitleStatus.TLabel",
        ).pack(side=LEFT, padx=(10, 0), pady=(3, 0))
        ttk.Label(title_block, text="P6 文案小组 · SVN 工作区自动化", style="Subtitle.TLabel").pack(anchor="w")

        header_actions = ttk.Frame(header, style="App.TFrame")
        header_actions.pack(side=RIGHT)
        self.music_button = ttk.Button(
            header_actions,
            text=ICON_MUSIC_ON,
            width=3,
            command=self._on_music_toggle,
            style="HeaderIconActive.TButton",
            takefocus=True,
        )
        self.music_button.pack(side=LEFT, padx=(0, 4))
        self.music_tooltip = ToolTip(self.music_button, "关闭背景音乐 (Alt+M)")
        self.tooltips.append(self.music_tooltip)
        self.hide_to_tray_button = ttk.Button(
            header_actions,
            text=ICON_HIDE_TO_TRAY,
            width=3,
            style="HeaderIcon.TButton",
            command=self._hide_to_tray,
            takefocus=True,
        )
        self.hide_to_tray_button.pack(side=LEFT, padx=(0, 4))
        self.tooltips.append(
            ToolTip(
                self.hide_to_tray_button,
                "隐藏到系统托盘 (Alt+H)",
            )
        )
        self.header_menu_button = ttk.Button(
            header_actions,
            text=ICON_MORE,
            width=3,
            style="HeaderIcon.TButton",
            command=self._show_header_menu,
            takefocus=True,
        )
        self.header_menu_button.pack(side=LEFT, padx=(0, 8))
        self.tooltips.append(
            ToolTip(self.header_menu_button, "更多操作 (Alt+A)")
        )
        self.run_button = ttk.Button(header_actions, text="立即执行", style="Accent.TButton", command=self._run_now)
        self.run_button.pack(side=LEFT)
        self.root.bind_all("<Alt-m>", self._on_music_shortcut)
        self.root.bind_all("<Alt-h>", self._on_hide_to_tray_shortcut)
        self.root.bind_all("<Alt-a>", self._on_header_menu_shortcut)
        self.root.bind_all("<Control-s>", self._on_save_shortcut)

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
        settings.pack(fill=X, pady=(0, 4))

        options = ttk.Frame(settings, style="Card.TFrame", padding=(12, 6))
        options.pack(side=LEFT, fill=BOTH, expand=True, padx=(0, 5))
        options_header = ttk.Frame(options, style="Card.TFrame")
        options_header.pack(fill=X, pady=(0, 3))
        ttk.Label(
            options_header,
            text="执行与自动化",
            style="SectionTitle.TLabel",
        ).pack(side=LEFT)
        ttk.Label(
            options_header,
            textvariable=self.next_run_text,
            style="CardMuted.TLabel",
        ).pack(side=RIGHT)
        ttk.Label(
            options_header,
            text="下次",
            style="CardMuted.TLabel",
        ).pack(side=RIGHT, padx=(8, 4))
        time_entry = ttk.Entry(
            options_header,
            width=6,
            textvariable=self.schedule_time,
        )
        time_entry.pack(side=RIGHT)
        time_entry.bind(
            "<FocusOut>",
            lambda _event: self._on_schedule_changed(),
        )
        time_entry.bind(
            "<Return>",
            lambda _event: self._on_schedule_changed(),
        )
        ttk.Checkbutton(
            options_header,
            text="每日定时",
            variable=self.enable_schedule,
            command=self._on_schedule_changed,
            style="Card.TCheckbutton",
        ).pack(side=RIGHT, padx=(0, 7))
        self._build_option_script_row(
            options,
            self.run_bin_update,
            text="每日更新主干 Bin 包",
            choose_text="Update位置",
            choose_command=self._choose_update_bat_path,
            clear_command=self._clear_update_bat_path,
            pady=(2, 0),
        )
        self._build_option_script_row(
            options,
            self.run_build_after_cleanup,
            text="Cleanup 后运行 res 目录 Build.bat",
            choose_text="Build位置",
            choose_command=self._choose_build_bat_path,
            clear_command=self._clear_build_bat_path,
            pady=(2, 0),
        )

        modules = ttk.Frame(settings, style="Card.TFrame", padding=(12, 6))
        modules.pack(side=LEFT, fill=BOTH, expand=True, padx=(5, 0))
        ttk.Label(modules, text="工具模块", style="SectionTitle.TLabel").pack(
            anchor="w",
            pady=(0, 3),
        )
        for index, spec in enumerate(TOOL_MODULES):
            self._build_tool_module_row(
                modules,
                spec,
                pady=(0, 0) if index == 0 else (3, 0),
            )

        live_header = ttk.Frame(main, style="App.TFrame")
        live_header.pack(fill=X, pady=(2, 6))
        ttk.Label(live_header, text="实时输出", style="SectionTitleApp.TLabel").pack(side=LEFT)
        self.completion_summary_label = ttk.Label(
            live_header,
            textvariable=self.completion_summary_text,
            width=34,
            anchor="e",
            style="RunSummary.TLabel",
        )
        self.completion_summary_label.pack(side=RIGHT)

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
        self.update_tooltip = ToolTip(self.update_dot, "检查 SVNmate 更新")
        self.tooltips.append(self.update_tooltip)
        self.signature_label = ttk.Label(main, text="SusamMinami", style="Signature.TLabel")
        self.signature_label.place(relx=1.0, rely=1.0, x=-6, y=-2, anchor="se")

    def _on_music_shortcut(self, _event: object = None) -> str:
        if str(self.music_button.cget("state")) != "disabled":
            self._on_music_toggle()
        return "break"

    def _on_hide_to_tray_shortcut(self, _event: object = None) -> str:
        self._hide_to_tray()
        return "break"

    def _on_header_menu_shortcut(self, _event: object = None) -> str:
        self._show_header_menu()
        return "break"

    def _on_save_shortcut(self, _event: object = None) -> str:
        if not self.running:
            self._save_config_with_feedback()
        return "break"

    def _save_config_with_feedback(self) -> None:
        self._save_config()
        self.status_text.set("配置已保存")

    def _show_header_menu(self) -> None:
        menu = Menu(self.root, tearoff=False)
        menu.add_command(
            label="保存配置",
            accelerator="Ctrl+S",
            state="disabled" if self.running else "normal",
            command=self._save_config_with_feedback,
        )
        menu.add_command(
            label="打开日志文件夹",
            command=self._open_log_folder,
        )
        menu.add_command(label="使用指南", command=self._open_user_guide)
        menu.add_separator()
        update_busy = self.update_state in {"checking", "downloading"}
        menu.add_command(
            label=(
                "下载并应用 SVNmate 更新"
                if self.update_state == "ready"
                else "检查 SVNmate 更新"
            ),
            state="disabled" if update_busy else "normal",
            command=self._on_update_dot_clicked,
        )
        menu.add_separator()
        menu.add_command(label="退出 SVNmate", command=self._exit_application)
        self._popup_menu(menu, self.header_menu_button)

    @staticmethod
    def _popup_menu(menu: Menu, button: ttk.Button) -> None:
        try:
            menu.tk_popup(
                button.winfo_rootx(),
                button.winfo_rooty() + button.winfo_height(),
            )
        finally:
            menu.grab_release()
            button.focus_set()

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
        tree.bind("<Button-3>", lambda event, key=group_key: self._show_folder_context_menu(event, key))
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

    def _build_tool_module_row(
        self,
        parent: ttk.Frame,
        spec: ToolModuleSpec,
        *,
        pady: tuple[int, int],
    ) -> None:
        row = ttk.Frame(parent, style="Card.TFrame")
        row.pack(fill=X, pady=pady)

        controls = ttk.Frame(row, style="Card.TFrame")
        controls.pack(fill=X)
        ttk.Label(
            controls,
            text=spec.display_name,
            style="CardTitle.TLabel",
            width=14,
        ).pack(side=LEFT)
        status_label = ttk.Label(
            controls,
            textvariable=self.tool_module_status[spec.module_id],
            style="ModuleStatus.TLabel",
            anchor="w",
        )
        status_label.pack(side=LEFT, fill=X, expand=True)
        action_button = ttk.Button(
            controls,
            text="安装",
            width=8,
            style="Compact.TButton",
            command=lambda current=spec: self._on_tool_module_primary(current),
        )
        action_button.pack(side=LEFT, padx=(4, 0))
        menu_button = ttk.Button(
            controls,
            text=ICON_MORE,
            width=3,
            style="CompactIcon.TButton",
            command=lambda current=spec: self._show_tool_module_menu(
                current,
                menu_button,
            ),
            takefocus=True,
        )
        menu_button.pack(side=LEFT, padx=(4, 0))
        self.tool_module_action_buttons[spec.module_id] = action_button
        self.tool_module_status_labels[spec.module_id] = status_label
        self.tool_module_path_tooltips[spec.module_id] = ToolTip(
            status_label,
            "程序位置将在检查后显示",
        )
        self.tooltips.append(self.tool_module_path_tooltips[spec.module_id])
        self.tooltips.append(
            ToolTip(menu_button, f"{spec.display_name}更多操作")
        )

    def _show_tool_module_menu(
        self,
        spec: ToolModuleSpec,
        button: ttk.Button,
    ) -> None:
        configured_path = self._configured_tool_module_path(spec)
        executable = self.tool_module_manager.executable_path(
            spec,
            configured_path,
        )
        installed = executable.is_file()
        state = self.tool_module_states.get(spec.module_id, "idle")
        busy = state in {"checking", "downloading"}
        manifest = self.tool_module_manifests.get(spec.module_id)

        menu = Menu(self.root, tearoff=False)
        menu.add_command(
            label=f"打开{spec.display_name}",
            state="normal" if installed and not busy else "disabled",
            command=lambda: self._launch_tool_module(spec, manual=True),
        )
        if spec.supports_updates:
            menu.add_command(
                label=(
                    f"更新到 v{manifest.version}"
                    if state == "ready" and manifest
                    else "检查更新"
                ),
                state="disabled" if busy else "normal",
                command=lambda: self._on_tool_module_update(spec),
            )
        menu.add_separator()
        menu.add_command(
            label="选择现有程序...",
            state="disabled" if busy else "normal",
            command=lambda: self._choose_tool_module_path(spec),
        )
        menu.add_command(
            label="打开安装位置",
            state="normal" if installed else "disabled",
            command=lambda: self._open_tool_module_folder(spec),
        )
        menu.add_command(
            label="复制程序路径",
            command=lambda: self._copy_tool_module_path(spec),
        )
        if spec == KINDLE_STATUS:
            menu.add_separator()
            menu.add_checkbutton(
                label="启动时联动",
                variable=self.launch_kindle_status_on_startup,
                command=self._on_kindle_status_setting_changed,
            )
        self._popup_menu(menu, button)

    def _open_tool_module_folder(self, spec: ToolModuleSpec) -> None:
        executable = self.tool_module_manager.executable_path(
            spec,
            self._configured_tool_module_path(spec),
        )
        if executable.parent.is_dir():
            os.startfile(str(executable.parent))

    def _copy_tool_module_path(self, spec: ToolModuleSpec) -> None:
        executable = self.tool_module_manager.executable_path(
            spec,
            self._configured_tool_module_path(spec),
        )
        self.root.clipboard_clear()
        self.root.clipboard_append(str(executable))
        self.status_text.set(f"已复制{spec.display_name}路径")

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
        detected_config_linker = self.tool_module_paths[CONFIG_LINKER.module_id].get()
        detected_kindle_status = self.tool_module_paths[KINDLE_STATUS.module_id].get()
        module_paths = module_paths_from_config(
            data,
            detected_config_linker=detected_config_linker,
            detected_kindle_status=detected_kindle_status,
            detected_migration_guard=(
                self.tool_module_paths[MIGRATION_GUARD.module_id].get()
            ),
        )
        for module_id, path in module_paths.items():
            self.tool_module_paths[module_id].set(path)
        self.launch_kindle_status_on_startup.set(
            bool(
                data.get(
                    "launch_kindle_status_on_startup",
                    bool(module_paths[KINDLE_STATUS.module_id]),
                )
            )
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
            "tool_module_paths": {
                module_id: variable.get().strip()
                for module_id, variable in self.tool_module_paths.items()
            },
            "enable_schedule": self.enable_schedule.get(),
            "schedule_time": self.schedule_time.get().strip(),
            "last_bin_update_date": self.last_bin_update_date,
        }
        CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        self._refresh_next_run_text()
        self._refresh_tool_module_rows()

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
    def _find_default_config_linker_executable() -> Path | None:
        candidates = [
            APP_DIR / "ConfigLinker.exe",
            APP_DIR / "config_id_lookup" / "dist" / "ConfigLinker.exe",
        ]
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        return None

    @staticmethod
    def _find_default_migration_guard_executable() -> Path | None:
        candidates = [
            APP_DIR / MIGRATION_GUARD.executable_name,
            APP_DIR / "dist" / MIGRATION_GUARD.executable_name,
            APP_DIR
            / "migration_guard"
            / "dist"
            / MIGRATION_GUARD.executable_name,
        ]
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        return None

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

    def _configured_tool_module_path(
        self,
        spec: ToolModuleSpec,
    ) -> str | None:
        path_text = self.tool_module_paths[spec.module_id].get().strip()
        return path_text or None

    def _resolve_tool_module_executable(
        self,
        spec: ToolModuleSpec,
    ) -> Path | None:
        executable = self.tool_module_manager.executable_path(
            spec,
            self._configured_tool_module_path(spec),
        )
        if not executable.is_file():
            return None
        try:
            return executable.resolve()
        except OSError:
            return executable

    def _resolve_kindle_status_executable(self) -> Path | None:
        return self._resolve_tool_module_executable(KINDLE_STATUS)

    def _refresh_tool_module_rows(self) -> None:
        for spec in TOOL_MODULES:
            configured_path = self._configured_tool_module_path(spec)
            executable = self.tool_module_manager.executable_path(
                spec,
                configured_path,
            )
            installed = executable.is_file()
            version = self.tool_module_manager.local_version(
                spec,
                configured_path,
            )
            state = self.tool_module_states.get(spec.module_id, "idle")
            manifest = self.tool_module_manifests.get(spec.module_id)

            if not spec.supports_updates:
                status = "已安装 · 本地版本" if installed else "未选择"
            elif state == "checking":
                status = "检查中..."
            elif state == "downloading":
                status = "下载并安装中..."
            elif state == "failed":
                status = "检查失败"
            elif state == "ready" and manifest:
                action = "可更新" if installed else "可安装"
                status = f"{action} v{manifest.version}"
            elif installed and version != "0.0.0":
                status = f"已安装 v{version}"
            elif installed:
                status = "已安装 · 版本未知"
            else:
                status = "未安装"
            self.tool_module_status[spec.module_id].set(status)

            action_button = self.tool_module_action_buttons.get(spec.module_id)
            status_label = self.tool_module_status_labels.get(spec.module_id)
            path_tooltip = self.tool_module_path_tooltips.get(spec.module_id)
            busy = state in {"checking", "downloading"}
            if action_button:
                action_button.configure(
                    text=tool_module_primary_label(
                        spec,
                        installed=installed,
                        state=state,
                    ),
                    state="disabled" if busy else "normal",
                )
            if status_label:
                status_label.configure(
                    style=(
                        "ModuleStatusBusy.TLabel"
                        if busy
                        else "ModuleStatusError.TLabel"
                        if state == "failed"
                        else "ModuleStatusReady.TLabel"
                        if state == "ready"
                        else "ModuleStatusSuccess.TLabel"
                        if installed
                        else "ModuleStatus.TLabel"
                    )
                )
            if path_tooltip:
                path_tooltip.set_text(
                    f"{status}\n程序位置：{executable}"
                )

    def _on_kindle_status_setting_changed(self) -> None:
        self._save_config()

    def _choose_tool_module_path(self, spec: ToolModuleSpec) -> None:
        executable = self._resolve_tool_module_executable(spec)
        initial_dir = executable.parent if executable else Path.home() / "Downloads"
        file_path = filedialog.askopenfilename(
            title=f"选择{spec.display_name}程序",
            initialdir=str(initial_dir),
            filetypes=(
                (spec.display_name, spec.executable_name),
                ("可执行程序", "*.exe"),
                ("所有文件", "*.*"),
            ),
        )
        if not file_path:
            return
        selected = Path(file_path)
        if selected.name.casefold() != spec.executable_name.casefold():
            messagebox.showwarning(
                "程序不匹配",
                f"请选择名为 {spec.executable_name} 的程序。",
            )
            return
        self.tool_module_paths[spec.module_id].set(str(selected))
        self.tool_module_states[spec.module_id] = "idle"
        self.tool_module_manifests.pop(spec.module_id, None)
        if spec == KINDLE_STATUS:
            self.launch_kindle_status_on_startup.set(True)
        self._save_config()
        self._check_tool_module_async(spec)

    def _choose_kindle_status_path(self) -> None:
        self._choose_tool_module_path(KINDLE_STATUS)

    def _launch_kindle_status_at_startup(self) -> None:
        if self.launch_kindle_status_on_startup.get():
            self._launch_kindle_status(manual=False)

    def _launch_kindle_status(self, manual: bool) -> None:
        self._launch_tool_module(KINDLE_STATUS, manual=manual)

    def _launch_tool_module(
        self,
        spec: ToolModuleSpec,
        *,
        manual: bool,
    ) -> None:
        try:
            result = self.tool_module_manager.launch(
                spec,
                self._configured_tool_module_path(spec),
            )
        except OSError as exc:
            self._log(f"{spec.display_name}启动失败：{exc}")
            if manual:
                messagebox.showerror("模块启动失败", str(exc))
            return
        if result == "install-required":
            message = f"{spec.display_name}尚未安装，请先安装或选择现有程序。"
            self._log(message)
            if manual:
                messagebox.showwarning("无法打开模块", message)
            return
        if result == "already-running":
            self._log(f"{spec.display_name}已在运行，已跳过重复启动。")
            if manual:
                messagebox.showinfo(spec.display_name, "程序已经在运行。")
            return
        executable = self.tool_module_manager.executable_path(
            spec,
            self._configured_tool_module_path(spec),
        )
        self._log(f"已启动{spec.display_name}：{executable}")

    def _on_tool_module_primary(self, spec: ToolModuleSpec) -> None:
        if (
            self.tool_module_states.get(spec.module_id) == "ready"
            and spec.module_id in self.tool_module_manifests
        ):
            self._start_tool_module_install(spec)
            return
        if self.tool_module_manager.is_installed(
            spec,
            self._configured_tool_module_path(spec),
        ):
            self._launch_tool_module(spec, manual=True)
            return
        if not spec.supports_updates:
            self._choose_tool_module_path(spec)
            return
        self._start_tool_module_install(spec)

    def _on_tool_module_update(self, spec: ToolModuleSpec) -> None:
        if self.tool_module_states.get(spec.module_id) == "ready":
            self._start_tool_module_install(spec)
            return
        self._check_tool_module_async(spec, manual=True)

    def _check_tool_modules_async(self) -> None:
        for spec in TOOL_MODULES:
            if spec.supports_updates:
                self._check_tool_module_async(spec)

    def _check_tool_module_async(
        self,
        spec: ToolModuleSpec,
        *,
        manual: bool = False,
        install_when_ready: bool = False,
    ) -> None:
        if not spec.supports_updates:
            self.tool_module_states[spec.module_id] = "idle"
            self._refresh_tool_module_rows()
            return
        if install_when_ready:
            self.tool_module_install_after_check.add(spec.module_id)
        if self.tool_module_states.get(spec.module_id) in {
            "checking",
            "downloading",
        }:
            return
        self.tool_module_states[spec.module_id] = "checking"
        self._refresh_tool_module_rows()
        threading.Thread(
            target=self._check_tool_module_worker,
            args=(spec, manual),
            daemon=True,
        ).start()

    def _check_tool_module_worker(
        self,
        spec: ToolModuleSpec,
        manual: bool,
    ) -> None:
        try:
            manifest = self.tool_module_manager.check_update(spec)
        except Exception as exc:
            message = str(exc)
            self.root.after(
                0,
                lambda: self._tool_module_check_failed(spec, message),
            )
            return
        self.root.after(
            0,
            lambda: self._tool_module_manifest_ready(spec, manifest, manual),
        )

    def _tool_module_check_failed(
        self,
        spec: ToolModuleSpec,
        message: str,
    ) -> None:
        self.tool_module_install_after_check.discard(spec.module_id)
        self.tool_module_states[spec.module_id] = "failed"
        self._refresh_tool_module_rows()
        self._log(f"{spec.display_name}检查更新失败：{message}")

    def _tool_module_manifest_ready(
        self,
        spec: ToolModuleSpec,
        manifest: ModuleManifest,
        manual: bool,
    ) -> None:
        self.tool_module_manifests[spec.module_id] = manifest
        configured_path = self._configured_tool_module_path(spec)
        installed = self.tool_module_manager.is_installed(spec, configured_path)
        update_available = (
            not installed
            or self.tool_module_manager.update_available(
                spec,
                manifest,
                configured_path,
            )
        )
        self.tool_module_states[spec.module_id] = (
            "ready" if update_available else "idle"
        )
        self._refresh_tool_module_rows()
        if update_available:
            action = "可安装" if not installed else "可更新"
            self._log(
                f"{spec.display_name}{action}到 v{manifest.version}。"
            )
        elif manual:
            self._log(f"{spec.display_name}已是最新版本。")
        if spec.module_id in self.tool_module_install_after_check:
            self.tool_module_install_after_check.discard(spec.module_id)
            if update_available:
                self._confirm_tool_module_install(spec, manifest)

    def _start_tool_module_install(self, spec: ToolModuleSpec) -> None:
        manifest = self.tool_module_manifests.get(spec.module_id)
        if manifest is None:
            self._check_tool_module_async(
                spec,
                manual=True,
                install_when_ready=True,
            )
            return
        self._confirm_tool_module_install(spec, manifest)

    def _confirm_tool_module_install(
        self,
        spec: ToolModuleSpec,
        manifest: ModuleManifest,
    ) -> None:
        configured_path = self._configured_tool_module_path(spec)
        installed = self.tool_module_manager.is_installed(spec, configured_path)
        running = self.tool_module_manager.is_running(spec)
        action = "更新" if installed else "安装"
        details = (
            f"将{action}{spec.display_name} v{manifest.version}。\n"
            "只会替换程序文件和公开版本文件，模块配置不会被覆盖。"
        )
        if running:
            interruption = (
                "\n\n程序当前正在运行，确认后会关闭并在更新完成后重新启动。"
            )
            if spec == KINDLE_STATUS:
                interruption = (
                    "\n\nKindle 提示板当前正在运行，更新 Windows 模块会"
                    "短暂中断刷新服务，完成后将自动重启。"
                )
            details += interruption
        if not messagebox.askyesno(f"{action}{spec.display_name}", details):
            return

        self.tool_module_states[spec.module_id] = "downloading"
        self._refresh_tool_module_rows()
        threading.Thread(
            target=self._install_tool_module_worker,
            args=(spec, manifest, configured_path, running),
            daemon=True,
        ).start()

    def _install_tool_module_worker(
        self,
        spec: ToolModuleSpec,
        manifest: ModuleManifest,
        configured_path: str | None,
        was_running: bool,
    ) -> None:
        archive = (
            APP_DIR
            / "_module_updates"
            / spec.module_id
            / f"{spec.install_folder}.zip"
        )
        stopped = False
        try:
            download_archive(manifest.download_url, archive)
            if was_running:
                if not self.tool_module_manager.stop(spec):
                    raise ModuleUpdateError(
                        f"无法关闭正在运行的{spec.display_name}"
                    )
                stopped = True
            target = self.tool_module_manager.install_archive(
                spec,
                manifest,
                archive,
                configured_path,
            )
            if was_running:
                launch_result = self.tool_module_manager.launch(
                    spec,
                    configured_path,
                )
                if launch_result != "started":
                    raise ModuleUpdateError(
                        f"{spec.display_name}更新后未能重新启动"
                    )
        except Exception as exc:
            if stopped:
                try:
                    self.tool_module_manager.launch(spec, configured_path)
                except OSError:
                    pass
            message = str(exc)
            self.root.after(
                0,
                lambda: self._tool_module_install_failed(spec, message),
            )
            return
        self.root.after(
            0,
            lambda: self._tool_module_install_succeeded(
                spec,
                manifest,
                target,
            ),
        )

    def _tool_module_install_succeeded(
        self,
        spec: ToolModuleSpec,
        manifest: ModuleManifest,
        target: Path,
    ) -> None:
        self.tool_module_states[spec.module_id] = "idle"
        self._refresh_tool_module_rows()
        self._log(
            f"{spec.display_name} v{manifest.version} 已安装：{target}"
        )
        messagebox.showinfo(
            f"{spec.display_name}安装完成",
            f"已安装 v{manifest.version}。",
        )

    def _tool_module_install_failed(
        self,
        spec: ToolModuleSpec,
        message: str,
    ) -> None:
        self.tool_module_states[spec.module_id] = (
            "ready"
            if spec.module_id in self.tool_module_manifests
            else "failed"
        )
        self._refresh_tool_module_rows()
        self._log(f"{spec.display_name}安装失败：{message}")
        messagebox.showerror(
            f"{spec.display_name}安装失败",
            message,
        )


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
        if self.music_paused_after_task and self.music_enabled.get():
            self.music_paused_after_task = False
        else:
            self.music_enabled.set(not self.music_enabled.get())
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
            self.music_button.configure(
                text=ICON_MUSIC_OFF,
                state="disabled",
                style="HeaderIcon.TButton",
            )
            tooltip = "未找到可播放的背景音乐"
        elif self.music_paused_after_task:
            self.music_button.configure(
                text=ICON_MUSIC_OFF,
                state="normal",
                style="HeaderIcon.TButton",
            )
            tooltip = "任务结束后已暂停，点击继续播放 (Alt+M)"
        elif self.music_enabled.get():
            self.music_button.configure(
                text=ICON_MUSIC_ON,
                state="normal",
                style="HeaderIconActive.TButton",
            )
            tooltip = "关闭背景音乐 (Alt+M)"
        else:
            self.music_button.configure(
                text=ICON_MUSIC_OFF,
                state="normal",
                style="HeaderIcon.TButton",
            )
            tooltip = "开启背景音乐 (Alt+M)"
        if hasattr(self, "music_tooltip"):
            self.music_tooltip.set_text(tooltip)

    def _theme_tick(self) -> None:
        theme = "night" if self._is_night_time() else "day"
        if theme != self.current_theme:
            self.current_theme = theme
            self._apply_visual_theme(theme)
        self.root.after(60000, self._theme_tick)

    def _dpi_tick(self) -> None:
        visible = self.root.state() != "withdrawn"
        if os.name == "nt" and visible:
            dpi = _get_window_dpi(self.root)
            if dpi > 0 and dpi != self.current_dpi:
                self.current_dpi = dpi
                self.root.tk.call("tk", "scaling", dpi / 72.0)
                self._refresh_window_minimum_size(dpi)
                self._apply_visual_theme(self.current_theme)
        delay = DPI_VISIBLE_POLL_MS if visible else DPI_HIDDEN_POLL_MS
        self.root.after(delay, self._dpi_tick)

    @staticmethod
    def _is_night_time() -> bool:
        hour = datetime.now().hour
        return hour >= 19 or hour < 6

    def _apply_visual_theme(self, theme: str) -> None:
        configure_svnmate_styles(self.root, self.ui_style, theme)
        self._refresh_update_dot()
        self._refresh_completion_summary_style()

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

    def _show_folder_context_menu(self, event: object, group_key: str) -> None:
        tree = self.folder_trees[group_key]
        row_id = tree.identify_row(event.y)
        if not row_id:
            return
        index = int(row_id)
        if index < 0 or index >= len(self.folder_groups[group_key]):
            return
        tree.selection_set(row_id)
        tree.focus(row_id)
        menu = Menu(tree, tearoff=False)
        menu.add_command(
            label="在资源管理器中打开",
            command=lambda: self._open_folder(group_key, index),
        )
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _open_folder(self, group_key: str, index: int) -> bool:
        if index < 0 or index >= len(self.folder_groups[group_key]):
            return False
        folder = Path(str(self.folder_groups[group_key][index].get("path", "")))
        if not folder.is_dir():
            messagebox.showwarning("无法打开文件夹", f"文件夹不存在：\n{folder}")
            return False
        try:
            os.startfile(str(folder))
        except OSError as exc:
            messagebox.showerror("无法打开文件夹", str(exc))
            return False
        return True

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
        self.root.after(SCHEDULE_POLL_MS, self._schedule_tick)

    def _run_now(self) -> None:
        self._start_worker(trigger="手动执行")

    def _start_ipc_server(self) -> None:
        if self.ipc_server.start():
            self._log("SVNmate 外部调用服务已就绪")
        else:
            self._log("SVNmate 外部调用服务未启动")

    def _handle_ipc_request(
        self,
        request: dict[str, object],
    ) -> dict[str, object]:
        command = request.get("command")
        if command == "ping":
            return {
                "protocol_version": IPC_PROTOCOL_VERSION,
                "request_id": request.get("request_id", ""),
                "command": "ping",
                "executed_by": "svnmate",
                "ok": True,
                "status": "busy" if self.running else "ready",
                "version": APP_VERSION,
            }
        if command != "update":
            return {
                "protocol_version": IPC_PROTOCOL_VERSION,
                "request_id": request.get("request_id", ""),
                "command": str(command or ""),
                "executed_by": "svnmate",
                "ok": False,
                "status": "unsupported-command",
                "message": "SVNmate 不支持该外部命令",
            }

        completed = threading.Event()
        response: dict[str, object] = {}
        try:
            self.root.after(
                0,
                lambda: self._start_ipc_update_on_ui_thread(
                    request,
                    response,
                    completed,
                ),
            )
        except Exception as exc:
            return {
                "protocol_version": IPC_PROTOCOL_VERSION,
                "request_id": request.get("request_id", ""),
                "command": "update",
                "executed_by": "svnmate",
                "ok": False,
                "status": "shutting-down",
                "message": str(exc),
            }
        if not completed.wait(IPC_REQUEST_TIMEOUT_SECONDS):
            return {
                "protocol_version": IPC_PROTOCOL_VERSION,
                "request_id": request.get("request_id", ""),
                "command": "update",
                "executed_by": "svnmate",
                "ok": False,
                "status": "timeout",
                "message": "等待 SVNmate 更新任务完成超时",
            }
        return response

    def _start_ipc_update_on_ui_thread(
        self,
        request: dict[str, object],
        response: dict[str, object],
        completed: threading.Event,
    ) -> None:
        if self.running:
            response.update(
                {
                    "protocol_version": IPC_PROTOCOL_VERSION,
                    "request_id": request.get("request_id", ""),
                    "command": "update",
                    "executed_by": "svnmate",
                    "ok": False,
                    "status": "busy",
                    "message": "SVNmate 当前有任务正在执行",
                }
            )
            completed.set()
            return

        folders = [
            str(folder)
            for folder in request.get("folders", [])
            if isinstance(folder, str)
        ]
        source = " ".join(
            str(request.get("source", "external")).split()
        )[:80]
        trigger = f"外部更新（{source}）"
        self.running = True
        self._begin_run_summary()
        self.run_button.configure(state="disabled")
        self.live_log.configure(style="LiveLog.Treeview")
        self.status_text.set("外部更新中...")
        self._log(
            f"========== {trigger}开始："
            f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} =========="
        )
        self.worker_thread = threading.Thread(
            target=self._run_ipc_update,
            args=(
                trigger,
                folders,
                str(request.get("request_id", "")),
                response,
                completed,
            ),
            name="svnmate-ipc-update",
            daemon=True,
        )
        self.worker_thread.start()

    def _run_ipc_update(
        self,
        trigger: str,
        folders: list[str],
        request_id: str,
        response: dict[str, object],
        completed: threading.Event,
    ) -> None:
        try:
            result = self._workspace_update_service().update_folders(
                folders,
                request_id=request_id,
            )
            response.update(result.to_dict(executed_by="svnmate"))
            if not result.folders:
                self._record("", trigger, "失败", "没有可更新目录")
        except Exception as exc:
            self._record("", trigger, "失败", f"任务异常：{exc}")
            response.update(
                {
                    "protocol_version": IPC_PROTOCOL_VERSION,
                    "request_id": request_id,
                    "command": "update",
                    "executed_by": "svnmate",
                    "ok": False,
                    "status": "error",
                    "message": str(exc),
                }
            )
        finally:
            completed.set()
            self.log_queue.put(("done", self._make_run_summary(trigger)))

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
        self._begin_run_summary()
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
        valid_folders: list[Path] = []
        pending_bin_updates: list[tuple[Path, Future[bool]]] = []
        try:
            with ThreadPoolExecutor(max_workers=1, thread_name_prefix="svnmate-update-bat") as bat_executor:
                for folder_text in enabled_folders:
                    folder = Path(folder_text)
                    if not folder.exists() or not folder.is_dir():
                        self._record(folder_text, "检查文件夹", "失败", "文件夹不存在")
                        continue
                    valid_folders.append(folder)
                    update_ok = self._run_command(
                        folder,
                        self._svn_update_command(folder),
                        "svn update",
                        auto_cleanup=True,
                    )
                    attempted, success, queued = self._queue_update_bat_scripts(
                        folder,
                        update_ok,
                        run_daily_bin_update,
                        bat_executor,
                    )
                    bin_update_attempted = bin_update_attempted or attempted
                    bin_update_all_success = bin_update_all_success and success
                    pending_bin_updates.extend(queued)

                if pending_bin_updates:
                    self._log("[等待] SVN Update 已全部完成，等待后台 Update.bat 结束")
                for update_bat, future in pending_bin_updates:
                    try:
                        bin_update_all_success = future.result() and bin_update_all_success
                    except Exception as exc:
                        bin_update_all_success = False
                        self._record(str(update_bat.parent), "Update.bat", "失败", f"后台任务异常：{exc}")

            for folder in valid_folders:
                self._run_cleanup_and_build(folder)

            if run_daily_bin_update and bin_update_attempted and bin_update_all_success:
                self.last_bin_update_date = today
        except Exception as exc:
            self._record("", trigger, "失败", f"任务异常：{exc}")
        finally:
            self.log_queue.put(("done", self._make_run_summary(trigger)))

    def _queue_update_bat_scripts(
        self,
        folder: Path,
        update_ok: bool,
        run_daily_bin_update: bool,
        executor: ThreadPoolExecutor,
    ) -> tuple[bool, bool, list[tuple[Path, Future[bool]]]]:
        bin_update_attempted = False
        bin_update_success = True
        queued: list[tuple[Path, Future[bool]]] = []

        if update_ok and run_daily_bin_update:
            update_scripts = self._find_update_bat_scripts(folder)
            if update_scripts:
                for update_bat in update_scripts:
                    bin_update_attempted = True
                    self._record(str(update_bat.parent), "Update.bat", "后台执行", "继续处理后续文件夹的 SVN Update")
                    future = executor.submit(
                        self._run_command,
                        update_bat.parent,
                        self._bat_command(update_bat),
                        "Update.bat",
                        visible_console=True,
                    )
                    queued.append((update_bat, future))
            elif self.custom_update_bat_path.get().strip():
                bin_update_attempted = True
                bin_update_success = False
                self._record(str(folder), "Update.bat", "跳过", f"未找到自定义路径：{self.custom_update_bat_path.get().strip()}")
            else:
                for bin_folder in self._find_bin_folders(folder):
                    bin_update_attempted = True
                    bin_update_success = False
                    self._record(str(bin_folder / "WindowsNoEditor"), "Update.bat", "跳过", "未找到 WindowsNoEditor\\Update.bat")
        return bin_update_attempted, bin_update_success, queued

    def _run_cleanup_and_build(self, folder: Path) -> None:
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

    def _workspace_update_service(self) -> WorkspaceUpdateService:
        return WorkspaceUpdateService(
            executor=self._execute_workspace_update_command,
            update_command=self._svn_update_command,
            cleanup_command=self._svn_cleanup_command,
            event_sink=self._handle_workspace_update_event,
        )

    def _handle_workspace_update_event(self, event: UpdateEvent) -> None:
        if event.status == "开始":
            return
        self._record(
            event.folder,
            event.action,
            event.status,
            event.message,
        )

    def _execute_workspace_update_command(
        self,
        cwd: Path,
        command: Sequence[str],
        action: str,
    ) -> CommandExecution:
        return self._execute_command_once(
            cwd,
            list(command),
            action,
        )

    def _run_command(
        self,
        cwd: Path,
        command: list[str],
        action: str,
        auto_cleanup: bool = False,
        visible_console: bool = False,
    ) -> bool:
        if auto_cleanup and action == "svn update":
            result = self._workspace_update_service().update_folder(
                cwd,
                explicit_update_command=command,
                validate_folder=False,
            )
            return result.success

        execution = self._execute_command_once(
            cwd,
            command,
            action,
            visible_console=visible_console,
        )
        if execution.success:
            self._record(
                str(cwd),
                action,
                "成功",
                f"耗时 {execution.elapsed_seconds:.1f}s",
            )
            return True

        if (
            action == "Build.bat"
            and visible_console
            and execution.return_code != -1
        ):
            self._record(
                str(cwd),
                action,
                "完成",
                f"CMD 窗口已结束，返回码 {execution.return_code}",
            )
            return True

        self._record(str(cwd), action, "失败", execution.message[:300])
        return False

    def _execute_command_once(
        self,
        cwd: Path,
        command: list[str],
        action: str,
        *,
        visible_console: bool = False,
    ) -> CommandExecution:
        self._log(f"[开始] {action} | {cwd}")
        started = datetime.now()
        output_already_logged = False
        try:
            if self._is_tortoise_command(command):
                return_code, output, error = self._run_tortoise_command(cwd, command)
            elif visible_console:
                return_code, output, error = self._run_visible_console_command(cwd, command)
            else:
                return_code, output, error = self._run_streamed_command(
                    cwd,
                    command,
                )
                output_already_logged = True
        except FileNotFoundError as exc:
            return CommandExecution(
                return_code=-1,
                error=f"命令不存在：{exc.filename}",
                elapsed_seconds=(datetime.now() - started).total_seconds(),
            )
        except OSError as exc:
            return CommandExecution(
                return_code=-1,
                error=str(exc),
                elapsed_seconds=(datetime.now() - started).total_seconds(),
            )

        elapsed = (datetime.now() - started).total_seconds()
        if output and not output_already_logged:
            self._log(output)
        if error and not output_already_logged:
            self._log(error)
        return CommandExecution(
            return_code=return_code,
            output=output,
            error=error,
            elapsed_seconds=elapsed,
        )

    def _run_streamed_command(
        self,
        cwd: Path,
        command: list[str],
    ) -> tuple[int, str, str]:
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            shell=False,
            creationflags=self._creation_flags(),
        )
        output_tail: deque[str] = deque(maxlen=80)
        if process.stdout is not None:
            with process.stdout:
                for raw_line in process.stdout:
                    line = raw_line.rstrip()
                    if not line:
                        continue
                    self._log(line)
                    output_tail.append(line[-2000:])
        return process.wait(), "\n".join(output_tail), ""

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
        last_child_check_at = 0.0
        childless_since: float | None = None
        fallback_enter_sent = False
        while process.poll() is None:
            now = time.time()
            if now - last_child_check_at >= 1:
                last_child_check_at = now
                if self._has_running_child_process(process.pid):
                    childless_since = None
                    fallback_enter_sent = False
                elif childless_since is None:
                    childless_since = now

            ready_for_pause_input = childless_since is not None and now - childless_since >= 1
            if ready_for_pause_input and now - started_at > 5 and now - last_enter_at > 5:
                console_input_sent = self._write_enter_to_process_console(process.pid)
                if not console_input_sent and not fallback_enter_sent:
                    fallback_enter_sent = self._press_enter_for_process_window(process.pid, console_title)
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
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=False,
            creationflags=self._creation_flags(),
        )
        while process.poll() is None:
            if self._click_tortoise_done_buttons(process.pid, require_completion=True):
                self._log("已自动关闭 TortoiseSVN 完成提示窗口")
            time.sleep(0.5)
        time.sleep(0.5)
        return process.returncode or 0, "", ""

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

    @staticmethod
    def _has_running_child_process(process_id: int) -> bool:
        if os.name != "nt":
            return False

        class _ProcessEntry32W(ctypes.Structure):
            _fields_ = [
                ("dwSize", wintypes.DWORD),
                ("cntUsage", wintypes.DWORD),
                ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t),
                ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", wintypes.LONG),
                ("dwFlags", wintypes.DWORD),
                ("szExeFile", wintypes.WCHAR * 260),
            ]

        kernel32 = ctypes.windll.kernel32
        kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
        kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        snapshot = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)  # TH32CS_SNAPPROCESS
        if snapshot == wintypes.HANDLE(-1).value:
            return False

        try:
            entry = _ProcessEntry32W()
            entry.dwSize = ctypes.sizeof(entry)
            kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_ProcessEntry32W)]
            kernel32.Process32FirstW.restype = wintypes.BOOL
            kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_ProcessEntry32W)]
            kernel32.Process32NextW.restype = wintypes.BOOL
            if not kernel32.Process32FirstW(snapshot, ctypes.byref(entry)):
                return False
            while True:
                executable_name = entry.szExeFile.lower()
                is_console_host = executable_name in {
                    "conhost.exe",
                    "openconsole.exe",
                    "windowsterminal.exe",
                }
                if entry.th32ParentProcessID == process_id and not is_console_host:
                    return True
                if not kernel32.Process32NextW(snapshot, ctypes.byref(entry)):
                    return False
        finally:
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            kernel32.CloseHandle(snapshot)

    @staticmethod
    def _write_enter_to_process_console(process_id: int) -> bool:
        if os.name != "nt":
            return False

        kernel32 = ctypes.windll.kernel32
        if kernel32.GetConsoleCP():
            return False

        class _CharUnion(ctypes.Union):
            _fields_ = [
                ("UnicodeChar", wintypes.WCHAR),
                ("AsciiChar", ctypes.c_char),
            ]

        class _KeyEventRecord(ctypes.Structure):
            _fields_ = [
                ("bKeyDown", wintypes.BOOL),
                ("wRepeatCount", wintypes.WORD),
                ("wVirtualKeyCode", wintypes.WORD),
                ("wVirtualScanCode", wintypes.WORD),
                ("uChar", _CharUnion),
                ("dwControlKeyState", wintypes.DWORD),
            ]

        class _InputEvent(ctypes.Union):
            _fields_ = [
                ("KeyEvent", _KeyEventRecord),
                ("padding", ctypes.c_byte * 16),
            ]

        class _InputRecord(ctypes.Structure):
            _fields_ = [
                ("EventType", wintypes.WORD),
                ("Event", _InputEvent),
            ]

        kernel32.AttachConsole.argtypes = [wintypes.DWORD]
        kernel32.AttachConsole.restype = wintypes.BOOL
        if not kernel32.AttachConsole(process_id):
            return False

        console_input = None
        try:
            kernel32.CreateFileW.argtypes = [
                wintypes.LPCWSTR,
                wintypes.DWORD,
                wintypes.DWORD,
                ctypes.c_void_p,
                wintypes.DWORD,
                wintypes.DWORD,
                wintypes.HANDLE,
            ]
            kernel32.CreateFileW.restype = wintypes.HANDLE
            console_input = kernel32.CreateFileW(
                "CONIN$",
                0xC0000000,  # GENERIC_READ | GENERIC_WRITE
                0x00000003,  # FILE_SHARE_READ | FILE_SHARE_WRITE
                None,
                3,  # OPEN_EXISTING
                0,
                None,
            )
            if console_input == wintypes.HANDLE(-1).value:
                return False

            records = (_InputRecord * 2)()
            scan_code = ctypes.windll.user32.MapVirtualKeyW(0x0D, 0)
            for index, key_down in enumerate((True, False)):
                records[index].EventType = 0x0001  # KEY_EVENT
                key_event = records[index].Event.KeyEvent
                key_event.bKeyDown = key_down
                key_event.wRepeatCount = 1
                key_event.wVirtualKeyCode = 0x0D
                key_event.wVirtualScanCode = scan_code
                key_event.uChar.UnicodeChar = "\r"

            written = wintypes.DWORD()
            kernel32.WriteConsoleInputW.argtypes = [
                wintypes.HANDLE,
                ctypes.POINTER(_InputRecord),
                wintypes.DWORD,
                ctypes.POINTER(wintypes.DWORD),
            ]
            kernel32.WriteConsoleInputW.restype = wintypes.BOOL
            return bool(kernel32.WriteConsoleInputW(console_input, records, len(records), ctypes.byref(written)))
        finally:
            if console_input not in {None, wintypes.HANDLE(-1).value}:
                kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
                kernel32.CloseHandle.restype = wintypes.BOOL
                kernel32.CloseHandle(console_input)
            kernel32.FreeConsole()

    def _press_enter_for_process_window(self, process_id: int, title_keyword: str = "") -> bool:
        if os.name != "nt":
            return False

        sent = False
        user32 = ctypes.windll.user32
        enum_windows_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        vk_return = 0x0D
        keyeventf_keyup = 0x0002
        user32.GetForegroundWindow.restype = wintypes.HWND
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.SetForegroundWindow.restype = wintypes.BOOL
        user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.ShowWindow.restype = wintypes.BOOL
        user32.keybd_event.argtypes = [
            wintypes.BYTE,
            wintypes.BYTE,
            wintypes.DWORD,
            ctypes.c_ulonglong,
        ]
        previous_foreground = user32.GetForegroundWindow()

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
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                if not user32.SetForegroundWindow(hwnd):
                    return True
                time.sleep(0.05)
                scan_code = user32.MapVirtualKeyW(vk_return, 0)
                user32.keybd_event(vk_return, scan_code, 0, 0)
                user32.keybd_event(vk_return, scan_code, keyeventf_keyup, 0)
                if previous_foreground and previous_foreground != hwnd:
                    user32.SetForegroundWindow(previous_foreground)
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
        return needs_svn_cleanup(message)

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

    def _begin_run_summary(self) -> None:
        lock = getattr(self, "run_outcomes_lock", None)
        if lock is not None:
            with lock:
                self.run_outcomes.clear()
        self._set_completion_summary("运行中 · 等待首个结果", "running")

    def _track_run_outcome(
        self,
        folder: str,
        action: str,
        status: str,
    ) -> None:
        if not getattr(self, "running", False):
            return
        outcomes = getattr(self, "run_outcomes", None)
        lock = getattr(self, "run_outcomes_lock", None)
        if outcomes is None or lock is None:
            return
        key = (folder, action)
        with lock:
            if status in {"自动恢复", "重试"}:
                outcomes.pop(key, None)
            elif status in {"成功", "完成", "失败", "跳过"}:
                outcomes[key] = status

    def _make_run_summary(self, trigger: str) -> TaskRunSummary:
        outcomes = getattr(self, "run_outcomes", {})
        lock = getattr(self, "run_outcomes_lock", None)
        if lock is not None:
            with lock:
                values = tuple(outcomes.values())
        else:
            values = tuple(outcomes.values())
        return TaskRunSummary(
            trigger=trigger,
            succeeded=sum(status in {"成功", "完成"} for status in values),
            failed=sum(status == "失败" for status in values),
            skipped=sum(status == "跳过" for status in values),
        )

    def _set_completion_summary(self, text: str, tone: str) -> None:
        self.completion_summary_state = tone
        if hasattr(self, "completion_summary_text"):
            self.completion_summary_text.set(text)
        self._refresh_completion_summary_style()

    def _refresh_completion_summary_style(self) -> None:
        if not hasattr(self, "completion_summary_label"):
            return
        style = {
            "running": "RunSummaryRunning.TLabel",
            "success": "RunSummarySuccess.TLabel",
            "warning": "RunSummaryWarning.TLabel",
            "error": "RunSummaryError.TLabel",
        }.get(
            getattr(self, "completion_summary_state", "idle"),
            "RunSummary.TLabel",
        )
        self.completion_summary_label.configure(style=style)

    def _record(self, folder: str, action: str, status: str, message: str) -> None:
        self._track_run_outcome(folder, action, status)
        finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._log(f"[{status}] {finished_at} | {action} | {folder} | {message}")

    def _log(self, line: str) -> None:
        timestamped = f"{datetime.now().strftime('%H:%M:%S')}  {line}"
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            with self._current_log_path().open("a", encoding="utf-8") as fp:
                fp.write(timestamped + "\n")
        except OSError:
            pass
        if len(timestamped) > MAX_LIVE_LOG_CHARS:
            visible_text = (
                timestamped[:MAX_LIVE_LOG_CHARS]
                + " ... [界面已截断，完整内容见日志文件]"
            )
        else:
            visible_text = timestamped
        try:
            self.log_queue.put_nowait(("log", visible_text))
        except queue.Full:
            self.dropped_live_log_items += 1

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
        log_payloads: list[object] = []
        done_payloads: list[object] = []
        try:
            while True:
                item_type, payload = self.log_queue.get_nowait()
                if item_type == "log":
                    log_payloads.append(payload)
                elif item_type == "done":
                    done_payloads.append(payload)
        except queue.Empty:
            pass
        if self.dropped_live_log_items:
            log_payloads.append(
                f"实时日志过多，已省略 {self.dropped_live_log_items} 条；"
                "完整内容仍保存在日志文件中。"
            )
            self.dropped_live_log_items = 0
        for payload in log_payloads:
            self.live_log.insert("", END, values=(payload,))
        if log_payloads:
            children = self.live_log.get_children()
            excess = len(children) - MAX_LIVE_LOG_ROWS
            if excess > 0:
                self.live_log.delete(*children[:excess])
            self.live_log.yview_moveto(1.0)
        if self.running and not done_payloads:
            current = self._make_run_summary("")
            if current.succeeded or current.failed or current.skipped:
                self._set_completion_summary(
                    "运行中 · 步骤："
                    f"成功 {current.succeeded} · "
                    f"失败 {current.failed} · "
                    f"跳过 {current.skipped}",
                    "running",
                )
        for payload in done_payloads:
            summary = (
                payload
                if isinstance(payload, TaskRunSummary)
                else TaskRunSummary(str(payload), 0, 0, 0)
            )
            self.running = False
            self.worker_thread = None
            self.run_button.configure(state="normal")
            self.status_text.set(summary.status_text)
            self._set_completion_summary(summary.detail_text, summary.tone)
            self._save_config()
            self._log(
                f"========== {summary.trigger}结束："
                f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} =========="
            )
            self._log(summary.detail_text)
            self.live_log.configure(
                style={
                    "success": "Completed.LiveLog.Treeview",
                    "warning": "Warning.LiveLog.Treeview",
                    "error": "Failed.LiveLog.Treeview",
                }[summary.tone]
            )
            self._fade_out_music_after_tasks()
        delay = (
            LOG_ACTIVE_POLL_MS
            if self.running or not self.log_queue.empty()
            else LOG_IDLE_POLL_MS
        )
        self.root.after(delay, self._poll_log_queue)

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
        self.root.after(TRAY_ACTION_POLL_MS, self._poll_tray_actions)

    def _hide_to_tray(self) -> None:
        if not self.tray_icon.ensure_visible():
            self._log("系统托盘图标不可用，已取消隐藏主窗口。")
            messagebox.showwarning(
                "无法隐藏到托盘",
                "系统托盘图标暂时不可用，主窗口将保持打开。",
            )
            return
        self.root.withdraw()
        if not getattr(self, "tray_hint_shown", False):
            self.tray_icon.show_notification(
                "SVNmate 仍在运行",
                "双击托盘图标可恢复窗口；右键可立即执行或退出。",
            )
            self.tray_hint_shown = True

    def _show_from_tray(self) -> None:
        self.root.deiconify()
        self.root.state("normal")
        self.root.lift()
        if os.name == "nt":
            try:
                user32 = ctypes.windll.user32
                user32.GetParent.argtypes = [ctypes.c_void_p]
                user32.GetParent.restype = wintypes.HWND
                user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
                user32.SetForegroundWindow.argtypes = [wintypes.HWND]
                child_hwnd = self.root.winfo_id()
                hwnd = user32.GetParent(child_hwnd) or child_hwnd
                user32.ShowWindow(hwnd, 9)
                user32.SetForegroundWindow(hwnd)
            except (AttributeError, OSError):
                pass
        self.root.after(80, self.root.focus_force)

    def _is_main_window_visible(self) -> bool:
        if self.root.state() == "withdrawn":
            return False
        if os.name != "nt":
            return True
        try:
            user32 = ctypes.windll.user32
            user32.GetParent.argtypes = [ctypes.c_void_p]
            user32.GetParent.restype = wintypes.HWND
            user32.IsWindowVisible.argtypes = [wintypes.HWND]
            user32.IsWindowVisible.restype = wintypes.BOOL
            child_hwnd = self.root.winfo_id()
            hwnd = user32.GetParent(child_hwnd) or child_hwnd
            return bool(user32.IsWindowVisible(hwnd))
        except (AttributeError, OSError):
            return False

    def _toggle_from_tray(self) -> None:
        if self._is_main_window_visible():
            self._hide_to_tray()
            return
        self._show_from_tray()

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
        self.ipc_server.stop()
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
            tooltip = "发现 SVNmate 新版本，点击下载"
        elif self.update_state in {"checking", "downloading"}:
            self.update_dot.configure(text="◌", style="UpdateDot.TLabel")
            tooltip = (
                "正在下载 SVNmate 更新"
                if self.update_state == "downloading"
                else "正在检查 SVNmate 更新"
            )
        else:
            self.update_dot.configure(text="○", style="UpdateDot.TLabel")
            tooltip = "检查 SVNmate 更新"
        if hasattr(self, "update_tooltip"):
            self.update_tooltip.set_text(tooltip)

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
        self.ipc_server.stop()
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
$logPath = Join-Path (Split-Path -Parent $zipPath) 'apply_update.log'
$appExe = Join-Path $appDir 'SVNAutoTool.exe'

function Write-UpdateLog([string] $message) {{
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $logPath -Value "$timestamp  $message" -Encoding UTF8
}}

function Wait-FileUnlocked([string] $path, [int] $timeoutSeconds) {{
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {{
        if (-not (Test-Path -LiteralPath $path)) {{
            return
        }}
        try {{
            $stream = [System.IO.File]::Open(
                $path,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::ReadWrite,
                [System.IO.FileShare]::None
            )
            $stream.Dispose()
            return
        }} catch {{
            Start-Sleep -Milliseconds 500
        }}
    }}
    throw "等待程序文件解除占用超时：$path"
}}

try {{
    Write-UpdateLog '等待 SVNmate 退出'
    while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {{
        Start-Sleep -Milliseconds 500
    }}
    Wait-FileUnlocked $appExe 60

    if (Test-Path -LiteralPath $extractDir) {{
        Remove-Item -LiteralPath $extractDir -Recurse -Force
    }}
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    $payload = Join-Path $extractDir '一键更新SVN'
    if (-not (Test-Path -LiteralPath $payload -PathType Container)) {{
        $payload = $extractDir
    }}
    $payloadExe = Join-Path $payload 'SVNAutoTool.exe'
    if (-not (Test-Path -LiteralPath $payloadExe -PathType Leaf)) {{
        throw "更新包缺少程序文件：$payloadExe"
    }}

    Copy-Item -Path (Join-Path $payload '*') -Destination $appDir -Recurse -Force
    Start-Process -FilePath $appExe
    Write-UpdateLog '更新完成，已重新启动 SVNmate'
}} catch {{
    $message = $_.Exception.Message
    Write-UpdateLog "更新失败：$message"
    try {{
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            "SVNmate 更新失败：$message`n`n详细日志：$logPath",
            'SVNmate 更新失败',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }} catch {{
    }}
    exit 1
}}
"""
        script_path.write_text(script.strip(), encoding="utf-8-sig")
        creation_flags = 0
        if os.name == "nt":
            creation_flags = (
                subprocess.DETACHED_PROCESS
                | subprocess.CREATE_NEW_PROCESS_GROUP
                | subprocess.CREATE_NO_WINDOW
            )
        subprocess.Popen(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
            close_fds=True,
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
    instance_guard = SingleInstanceGuard()
    if not instance_guard.is_primary:
        try:
            instance_guard.notify_existing_instance()
        finally:
            instance_guard.close()
        return
    try:
        root = Tk()
        try:
            ttk.Style().theme_use("clam")
        except Exception:
            pass
        tool = SvnAutoTool(root)
        try:
            root.mainloop()
        finally:
            tool.ipc_server.stop()
    finally:
        instance_guard.close()


if __name__ == "__main__":
    main()
