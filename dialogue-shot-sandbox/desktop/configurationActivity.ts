import { spawn, type ChildProcess } from "node:child_process";
import { classifyConfigurationWindow, type ConfigurationActivity } from "../src/configurationActivity";

// A single small, out-of-process Win32 reader. No UE Python, reflection, UIA or window messages.
// Heartbeats detect a stalled helper; only changed states are sent to the renderer.
export const foregroundReaderScript = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SandboxForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder b, int c);
}
'@
while ($true) {
  try {
    $handle = [SandboxForeground]::GetForegroundWindow()
    $ownerId = [uint32]0
    [void][SandboxForeground]::GetWindowThreadProcessId($handle, [ref]$ownerId)
    $caption = [Text.StringBuilder]::new(1024)
    [void][SandboxForeground]::GetWindowText($handle, $caption, 1024)
    $processName = [Diagnostics.Process]::GetProcessById($ownerId).ProcessName
    $title64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($caption.ToString()))
    [Console]::WriteLine("$ownerId" + [char]9 + $processName + [char]9 + $title64)
  } catch { [Console]::WriteLine("0" + [char]9 + "unknown" + [char]9) }
  Start-Sleep -Milliseconds 400
}
`;

const pending: ConfigurationActivity = {
  state: "unknown", message: "正在识别工作窗口，暂缓 UE 自动读取",
};

export class ConfigurationActivityMonitor {
  private child: ChildProcess | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastBeat = 0;
  private lastExternal: ConfigurationActivity = pending;
  private snapshot: ConfigurationActivity = pending;

  constructor(private readonly changed: (snapshot: ConfigurationActivity) => void) {}

  getSnapshot() { return this.snapshot; }

  start() {
    if (this.child) return;
    this.lastExternal = pending;
    this.publish(pending);
    if (process.platform !== "win32") {
      this.publish({ state: "unknown", message: "当前系统不支持窗口识别，已暂停 UE 自动读取" });
      return;
    }
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(foregroundReaderScript, "utf16le").toString("base64"),
    ], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    this.child = child;
    this.lastBeat = Date.now();
    let buffer = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      if (this.child !== child) return;
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const [id, processName, title64] = line.split("\t");
        if (!/^\d+$/.test(id) || !processName || title64 === undefined) continue;
        this.lastBeat = Date.now();
        // Editing in our own small window retains the last external editor context.
        if (Number(id) !== process.pid) {
          this.lastExternal = classifyConfigurationWindow({
            processId: Number(id), processName,
            title: Buffer.from(title64, "base64").toString("utf8"),
          });
        }
        this.publish(this.lastExternal);
      }
    });
    const failed = () => {
      if (this.child !== child) return;
      this.stop();
      this.publish({ state: "unknown", message: "窗口识别暂不可用，已暂停 UE 自动读取" });
    };
    child.on("error", failed);
    child.on("exit", failed);
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastBeat > 4_000) {
        this.lastExternal = pending;
        this.publish({ state: "unknown", message: "窗口识别未响应，已暂停 UE 自动读取" });
      }
    }, 1_000);
    this.watchdog.unref();
  }

  stop() {
    const child = this.child;
    this.child = null;
    child?.kill();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.lastExternal = pending;
    this.publish(pending);
  }

  private publish(snapshot: ConfigurationActivity) {
    if (snapshot.state === this.snapshot.state && snapshot.message === this.snapshot.message) return;
    this.snapshot = snapshot;
    this.changed(snapshot);
  }
}
