import ctypes
import sys
from pathlib import Path
from tkinter import Tk

from config_linker.ui import ConfigLinkerApp


def _enable_windows_dpi_awareness() -> None:
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except (AttributeError, OSError):
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except (AttributeError, OSError):
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except (AttributeError, OSError):
                pass


def _app_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def main() -> None:
    _enable_windows_dpi_awareness()
    root = Tk()
    ConfigLinkerApp(root, config_path=_app_directory() / "config_linker_config.json")
    root.mainloop()


if __name__ == "__main__":
    main()
