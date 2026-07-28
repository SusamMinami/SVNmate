import sys
from pathlib import Path

from config_linker.dpi import enable_windows_dpi_awareness


enable_windows_dpi_awareness()

from tkinter import Tk

from config_linker.ui import ConfigLinkerApp


def _app_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def main() -> None:
    root = Tk()
    ConfigLinkerApp(root, config_path=_app_directory() / "config_linker_config.json")
    root.mainloop()


if __name__ == "__main__":
    main()
