import sys
from pathlib import Path

from config_linker.dpi import enable_windows_dpi_awareness


enable_windows_dpi_awareness()

from tkinter import TclError, Tk

from config_linker.ui import ConfigLinkerApp
from config_linker.update_controller import ConfigLinkerUpdateController


def _app_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _resource_directory() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def _app_version() -> str:
    version_file = _resource_directory() / "VERSION"
    try:
        version = version_file.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return "1.3.1"
    return version or "1.3.1"


def main() -> None:
    app_directory = _app_directory()
    app_version = _app_version()
    update_controller = None
    if getattr(sys, "frozen", False):
        update_controller = ConfigLinkerUpdateController(
            local_version=app_version,
            current_exe=Path(sys.executable).resolve(),
            work_dir=app_directory / "_updates" / "config-linker",
        )
    root = Tk()
    icon_path = _resource_directory() / "config_linker.ico"
    if icon_path.is_file():
        try:
            root.iconbitmap(default=str(icon_path))
        except TclError:
            pass
    ConfigLinkerApp(
        root,
        config_path=app_directory / "config_linker_config.json",
        app_version=app_version,
        update_controller=update_controller,
    )
    root.mainloop()


if __name__ == "__main__":
    main()
