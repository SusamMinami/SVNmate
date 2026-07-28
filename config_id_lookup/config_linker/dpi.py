import ctypes
import os
from dataclasses import dataclass
from tkinter import Tk


@dataclass(frozen=True)
class WindowGeometry:
    width: int
    height: int
    minimum_width: int
    minimum_height: int


@dataclass(frozen=True)
class WorkArea:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top


class _Rect(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


def enable_windows_dpi_awareness() -> None:
    if os.name != "nt":
        return
    try:
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
            return
    except (AttributeError, OSError, ValueError):
        pass
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError, ValueError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError, ValueError):
            pass


def get_window_dpi(root: Tk) -> int:
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


def configure_tk_dpi(root: Tk) -> int:
    root.update_idletasks()
    dpi = get_window_dpi(root)
    root.tk.call("tk", "scaling", dpi / 72.0)
    return dpi


def get_work_area(root: Tk) -> WorkArea:
    if os.name == "nt":
        try:
            rect = _Rect()
            if ctypes.windll.user32.SystemParametersInfoW(
                0x0030,
                0,
                ctypes.byref(rect),
                0,
            ):
                return WorkArea(rect.left, rect.top, rect.right, rect.bottom)
        except (AttributeError, OSError, ValueError):
            pass
    return WorkArea(0, 0, root.winfo_screenwidth(), root.winfo_screenheight())


def window_geometry(
    dpi: int,
    screen_width: int,
    screen_height: int,
    work_width: int | None = None,
    work_height: int | None = None,
) -> WindowGeometry:
    scale = max(dpi, 96) / 96.0
    available_width = work_width or screen_width
    available_height = work_height or screen_height
    width = min(round(1320 * scale), max(980, available_width - 48))
    height = min(round(820 * scale), max(640, available_height - 72))
    return WindowGeometry(
        width=width,
        height=height,
        minimum_width=min(round(1120 * scale), width),
        minimum_height=min(round(680 * scale), height),
    )
