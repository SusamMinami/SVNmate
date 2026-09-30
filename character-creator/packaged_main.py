"""Frozen Windows entry point for the portable test build."""
import ctypes
import json
import sys
import urllib.request
import webbrowser

from backend.server import main as run_server


DEFAULT_URL = "http://127.0.0.1:8766"


def service_available():
    try:
        with urllib.request.urlopen(DEFAULT_URL + "/api/bootstrap", timeout=1) as response:
            return json.load(response).get("app") == "character-creator"
    except Exception:
        return False


def show_error(message):
    ctypes.windll.user32.MessageBoxW(
        0,
        str(message),
        "角色创建工具启动失败",
        0x10,
    )


def main():
    default_launch = len(sys.argv) == 1
    if default_launch and service_available():
        webbrowser.open(DEFAULT_URL)
        return
    if default_launch:
        sys.argv.append("--open")
    try:
        run_server()
    except Exception as exc:
        show_error(exc)
        raise


if __name__ == "__main__":
    main()
