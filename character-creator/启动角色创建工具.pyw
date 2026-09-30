"""Double-click launcher; starts the local service without a console window."""
from pathlib import Path
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import messagebox
import urllib.request
import json
import webbrowser

ROOT = Path(__file__).resolve().parent
URL = "http://127.0.0.1:8766"
window = tk.Tk()
window.title("角色创建工具")
window.geometry("420x120")
window.configure(bg="#F2F2F0")
tk.Label(window, text="正在启动角色创建工具…", font=("Microsoft YaHei UI", 12),
         bg="#F2F2F0", fg="#191919").pack(expand=True)


def available():
    try:
        with urllib.request.urlopen(URL + "/api/bootstrap", timeout=1) as response:
            return json.load(response).get("app") == "character-creator"
    except Exception:
        return False


def launch():
    try:
        if not available():
            if not (ROOT / "dist" / "index.html").is_file():
                raise RuntimeError("首次使用请在本目录运行 npm install 和 npm run build。")
            import openpyxl  # noqa: F401
            import win32com.client  # noqa: F401
            local = ROOT / ".local"
            local.mkdir(exist_ok=True)
            with (local / "server.log").open("a", encoding="utf-8") as log:
                child = subprocess.Popen([sys.executable, "-m", "backend.server"],
                                         cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                         creationflags=subprocess.CREATE_NO_WINDOW)
            for _ in range(60):
                if available():
                    break
                if child.poll() is not None:
                    raise RuntimeError("本机服务未能启动。请查看 .local/server.log，或检查 8766 端口占用。")
                time.sleep(0.5)
            else:
                raise RuntimeError("启动超过 30 秒。可稍后访问本机地址，日志位于 .local/server.log。")
        webbrowser.open(URL)
        window.after(0, window.destroy)
    except Exception as exc:
        message = str(exc)
        def failed():
            messagebox.showerror("启动失败", message)
            window.destroy()
        window.after(0, failed)


threading.Thread(target=launch, daemon=True).start()
window.mainloop()
