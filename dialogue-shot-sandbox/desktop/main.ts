import { createServer, type Server } from "node:http";
import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} from "electron";
import updater from "electron-updater";
import storyboardSkill from "../../.agents/skills/internal-storyboard-director/SKILL.md";
import {
  routeStoryboardMcpRequest,
  runStoryboardMcpServer,
} from "../mcp/storyboardServer";
import { routeLarkRequest } from "../server/larkBridge";
import {
  configureConfigCsvDirectory,
  configureUnrealMcpPort,
  getConfigCsvDirectory,
  getUnrealMcpEndpoint,
  inspectUnrealMcpConnection,
  routeUeRequest,
} from "../server/ueBridge";
import {
  getStoryboardMcpPresence,
  STORYBOARD_MCP_VERSION,
} from "../server/storyboardMcpHeartbeat";
import {
  routeTraeRequest,
  storyboardMcpConfigPath,
  storyboardMcpConfigTemplate,
} from "../server/traeBridge";

const { autoUpdater } = updater;
const UPDATE_PAGE =
  "https://github.com/SusamMinami/SVNmate/releases/tag/shot-sandbox-update";
const DESKTOP_PORT = 43127;
const isMcpProcess = process.argv.includes("--storyboard-mcp");
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

interface DesktopState {
  setupCompleted: boolean;
  ueMcpPort: number;
  dataCsvDirectory: string;
}

interface UpdateSnapshot {
  state:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "current"
    | "error";
  version?: string;
  percent?: number;
  message?: string;
}

let mainWindow: BrowserWindow | null = null;
let localServer: Server | null = null;
let updateSnapshot: UpdateSnapshot = { state: "idle" };

function dataRoot(): string {
  return join(app.getPath("appData"), "Shot Sandbox");
}

function runtimeRoot(): string {
  return join(dataRoot(), "runtime");
}

function integrationRoot(): string {
  return join(dataRoot(), "trae-integration");
}

function statePath(): string {
  return join(dataRoot(), "desktop-state.json");
}

function configureRuntimeEnvironment(): void {
  const executable =
    process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const mcpArguments = app.isPackaged
    ? ["--storyboard-mcp"]
    : [app.getAppPath(), "--storyboard-mcp"];
  process.env.STORYBOARD_PROJECT_ROOT = runtimeRoot();
  process.env.STORYBOARD_WORKSPACE_ROOT = integrationRoot();
  process.env.STORYBOARD_MCP_CONFIG_PATH = join(
    integrationRoot(),
    ".trae",
    "mcp.json",
  );
  process.env.STORYBOARD_MCP_URL = `http://127.0.0.1:${DESKTOP_PORT}/mcp`;
  process.env.STORYBOARD_MCP_COMMAND = executable;
  process.env.STORYBOARD_MCP_ARGS_JSON = JSON.stringify(mcpArguments);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readDesktopState(): Promise<DesktopState> {
  try {
    const parsed = JSON.parse(
      await readFile(statePath(), "utf8"),
    ) as Partial<DesktopState>;
    return {
      setupCompleted: parsed.setupCompleted === true,
      ueMcpPort:
        Number.isInteger(parsed.ueMcpPort) &&
        Number(parsed.ueMcpPort) >= 1 &&
        Number(parsed.ueMcpPort) <= 65_535
          ? Number(parsed.ueMcpPort)
          : getUnrealMcpEndpoint().port,
      dataCsvDirectory:
        typeof parsed.dataCsvDirectory === "string" &&
        parsed.dataCsvDirectory.trim()
          ? parsed.dataCsvDirectory
          : getConfigCsvDirectory(),
    };
  } catch {
    return {
      setupCompleted: false,
      ueMcpPort: getUnrealMcpEndpoint().port,
      dataCsvDirectory: getConfigCsvDirectory(),
    };
  }
}

async function writeDesktopState(state: DesktopState): Promise<void> {
  await mkdir(dataRoot(), { recursive: true });
  await writeFile(statePath(), JSON.stringify(state, null, 2), "utf8");
}

function traeCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA || "";
  const appData = process.env.APPDATA || "";
  return [
    join(localAppData, "Programs", "Trae CN", "Trae CN.exe"),
    join(localAppData, "Programs", "Trae", "Trae.exe"),
    join(appData, "npm", "trae-cn.cmd"),
    join(appData, "npm", "trae.cmd"),
  ].filter(Boolean);
}

async function detectTrae(): Promise<string | null> {
  for (const candidate of traeCandidates()) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function integrationStatus(): Promise<{
  exists: boolean;
  current: boolean;
}> {
  try {
    const skillPath = join(
      integrationRoot(),
      ".agents",
      "skills",
      "internal-storyboard-director",
      "SKILL.md",
    );
    const [configText, installedSkill] = await Promise.all([
      readFile(storyboardMcpConfigPath(), "utf8"),
      readFile(skillPath, "utf8"),
    ]);
    const actual = JSON.parse(configText) as {
      mcpServers?: Record<
        string,
        { command?: string; args?: string[]; url?: string }
      >;
    };
    const expected = storyboardMcpConfigTemplate() as {
      mcpServers: Record<
        string,
        { command?: string; args?: string[]; url?: string }
      >;
    };
    const actualServer =
      actual.mcpServers?.["internal-storyboard-collaboration"];
    const expectedServer =
      expected.mcpServers["internal-storyboard-collaboration"];
    return {
      exists: true,
      current:
        actualServer?.url === expectedServer.url &&
        actualServer?.command === expectedServer.command &&
        JSON.stringify(actualServer?.args) ===
          JSON.stringify(expectedServer.args) &&
        installedSkill === storyboardSkill,
    };
  } catch {
    return { exists: false, current: false };
  }
}

async function installTraeIntegration(): Promise<void> {
  const configPath = storyboardMcpConfigPath();
  const skillPath = join(
    integrationRoot(),
    ".agents",
    "skills",
    "internal-storyboard-director",
    "SKILL.md",
  );
  await Promise.all([
    mkdir(join(integrationRoot(), ".trae"), { recursive: true }),
    mkdir(join(skillPath, ".."), { recursive: true }),
    mkdir(runtimeRoot(), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      configPath,
      JSON.stringify(storyboardMcpConfigTemplate(), null, 2),
      "utf8",
    ),
    writeFile(skillPath, storyboardSkill, "utf8"),
    writeFile(
      join(integrationRoot(), "README.txt"),
      [
        "镜头沙盘 TRAE 集成目录",
        "",
        "1. 使用 TRAE 打开本目录。",
        "2. 在 MCP 设置中启用 internal-storyboard-collaboration。",
        "3. 确认项目 Skill internal-storyboard-director 已启用。",
        "4. 保持镜头沙盘运行，并在 TRAE 中输入“处理待分镜任务”。",
        "",
        "本地 MCP 地址：http://127.0.0.1:43127/mcp",
      ].join("\r\n"),
      "utf8",
    ),
  ]);
}

async function migrateLegacyGlobalMcpConfiguration(): Promise<void> {
  const expectedServer = storyboardMcpConfigTemplate().mcpServers[
    "internal-storyboard-collaboration"
  ];
  if (!("url" in expectedServer)) {
    return;
  }
  const candidates = ["Trae CN", "Trae"].map((productName) =>
    join(app.getPath("appData"), productName, "User", "mcp.json"),
  );
  for (const configPath of candidates) {
    try {
      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        mcpServers?: Record<
          string,
          { command?: string; args?: string[]; url?: string }
        >;
      };
      const legacy =
        config.mcpServers?.["internal-storyboard-collaboration"];
      if (
        !legacy?.command?.toLowerCase().endsWith(".exe") ||
        !legacy.args?.includes("--storyboard-mcp")
      ) {
        continue;
      }
      config.mcpServers!["internal-storyboard-collaboration"] = {
        url: expectedServer.url,
      };
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[storyboard-mcp] global config migration failed", error);
      }
    }
  }
}

async function setupStatus() {
  const state = await readDesktopState();
  const [
    traeExecutable,
    integration,
    presence,
    defaultDataReady,
    ueConnection,
  ] =
    await Promise.all([
      detectTrae(),
      integrationStatus(),
      getStoryboardMcpPresence(),
      pathExists(join(state.dataCsvDirectory, "NPC表.csv")),
      inspectUnrealMcpConnection(),
    ]);
  return {
    firstRun:
      !state.setupCompleted ||
      (integration.exists && !integration.current),
    version: app.getVersion(),
    packaged: app.isPackaged,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    runtimeBundled: true,
    traeDetected: Boolean(traeExecutable),
    traeExecutable,
    integrationInstalled: integration.current,
    integrationRoot: integrationRoot(),
    mcpConnected: presence.connected && presence.compatible,
    mcpVersion: presence.serverVersion,
    expectedMcpVersion: STORYBOARD_MCP_VERSION,
    defaultDataReady,
    dataCsvDirectory: state.dataCsvDirectory,
    ueConnected: ueConnection.connected,
    ueMcpHost: ueConnection.host,
    ueMcpPort: ueConnection.port,
    ueConnectionMessage: ueConnection.message,
    updateSupported: app.isPackaged,
    updatePage: UPDATE_PAGE,
  };
}

function broadcastUpdate(snapshot: UpdateSnapshot): void {
  updateSnapshot = snapshot;
  mainWindow?.webContents.send("desktop:update-state", snapshot);
}

function configureUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => {
    broadcastUpdate({ state: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    broadcastUpdate({ state: "available", version: info.version });
  });
  autoUpdater.on("download-progress", (progress) => {
    broadcastUpdate({
      state: "downloading",
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    broadcastUpdate({ state: "downloaded", version: info.version });
  });
  autoUpdater.on("update-not-available", (info) => {
    broadcastUpdate({ state: "current", version: info.version });
  });
  autoUpdater.on("error", (error) => {
    broadcastUpdate({
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

async function checkForUpdates(): Promise<UpdateSnapshot> {
  if (!app.isPackaged) {
    const snapshot: UpdateSnapshot = {
      state: "current",
      version: app.getVersion(),
      message: "开发模式不检查在线更新",
    };
    broadcastUpdate(snapshot);
    return snapshot;
  }
  broadcastUpdate({ state: "checking" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    broadcastUpdate({
      state: "error",
      message: error instanceof Error ? error.message : "检查更新失败",
    });
  }
  return updateSnapshot;
}

function registerDesktopIpc(): void {
  ipcMain.handle("desktop:setup-status", () => setupStatus());
  ipcMain.handle("desktop:install-trae-integration", async () => {
    await installTraeIntegration();
    return setupStatus();
  });
  ipcMain.handle("desktop:open-integration-folder", async () => {
    await installTraeIntegration();
    const error = await shell.openPath(integrationRoot());
    if (error) {
      throw new Error(error);
    }
  });
  ipcMain.handle("desktop:open-trae-download", () =>
    shell.openExternal("https://www.trae.cn/ide/download"),
  );
  ipcMain.handle("desktop:complete-setup", async () => {
    const state = await readDesktopState();
    await writeDesktopState({ ...state, setupCompleted: true });
    return setupStatus();
  });
  ipcMain.handle(
    "desktop:set-data-directory",
    async (_event, directoryPath: unknown) => {
      const previousDirectory = getConfigCsvDirectory();
      let selectedDirectory = "";
      try {
        configureConfigCsvDirectory(String(directoryPath ?? ""));
        selectedDirectory = getConfigCsvDirectory();
        await access(join(selectedDirectory, "NPC表.csv"));
        const state = await readDesktopState();
        await writeDesktopState({
          ...state,
          dataCsvDirectory: selectedDirectory,
        });
        return setupStatus();
      } catch (error) {
        configureConfigCsvDirectory(previousDirectory);
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            `所选位置未找到 csvdir\\NPC表.csv：${selectedDirectory || String(directoryPath ?? "")}`,
          );
        }
        throw error;
      }
    },
  );
  ipcMain.handle("desktop:set-ue-port", async (_event, port: unknown) => {
    const numericPort =
      typeof port === "number" ? port : Number.parseInt(String(port), 10);
    configureUnrealMcpPort(numericPort);
    const state = await readDesktopState();
    await writeDesktopState({ ...state, ueMcpPort: numericPort });
    return setupStatus();
  });
  ipcMain.handle("desktop:check-update", () => checkForUpdates());
  ipcMain.handle("desktop:update-snapshot", () => updateSnapshot);
  ipcMain.handle("desktop:install-update", async () => {
    if (process.env.PORTABLE_EXECUTABLE_FILE) {
      await shell.openExternal(UPDATE_PAGE);
      return;
    }
    autoUpdater.quitAndInstall(false, true);
  });
  ipcMain.handle("desktop:open-update-page", () =>
    shell.openExternal(UPDATE_PAGE),
  );
}

async function serveStatic(
  requestPath: string,
  response: import("node:http").ServerResponse,
): Promise<void> {
  const rendererRoot = resolve(app.getAppPath(), "dist");
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(rendererRoot, normalize(relative));
  const filePath = candidate.startsWith(rendererRoot)
    ? candidate
    : join(rendererRoot, "index.html");
  let destination = filePath;
  try {
    if ((await stat(destination)).isDirectory()) {
      destination = join(destination, "index.html");
    }
  } catch {
    destination = join(rendererRoot, "index.html");
  }
  try {
    const body = await readFile(destination);
    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      contentTypes[extname(destination).toLowerCase()] ||
        "application/octet-stream",
    );
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
}

async function startLocalServer(): Promise<number> {
  localServer = createServer(async (request, response) => {
    if (await routeStoryboardMcpRequest(request, response)) {
      return;
    }
    if (await routeTraeRequest(request, response)) {
      return;
    }
    if (await routeUeRequest(request, response)) {
      return;
    }
    if (await routeLarkRequest(request, response)) {
      return;
    }
    await serveStatic(request.url || "/", response);
  });
  await new Promise<void>((resolvePromise, reject) => {
    localServer!.once("error", reject);
    localServer!.listen(DESKTOP_PORT, "127.0.0.1", () => resolvePromise());
  });
  const address = localServer.address();
  if (!address || typeof address === "string") {
    throw new Error("无法启动镜头沙盘本地服务");
  }
  return address.port;
}

async function createMainWindow(port: number): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#eef0f2",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) {
      event.preventDefault();
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

async function runDesktop(): Promise<void> {
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
    return;
  }
  await app.whenReady();
  configureRuntimeEnvironment();
  const desktopState = await readDesktopState();
  configureUnrealMcpPort(desktopState.ueMcpPort);
  configureConfigCsvDirectory(desktopState.dataCsvDirectory);
  await migrateLegacyGlobalMcpConfiguration();
  await installTraeIntegration();
  registerDesktopIpc();
  configureUpdater();
  const port = await startLocalServer();
  await createMainWindow(port);
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(port);
    }
  });
  if (app.isPackaged) {
    setTimeout(() => void checkForUpdates(), 20_000).unref();
  }
}

app.setName("镜头沙盘");
configureRuntimeEnvironment();

if (isMcpProcess) {
  runStoryboardMcpServer().catch((error) => {
    console.error("[storyboard-mcp] fatal", error);
    app.exit(1);
  });
} else {
  runDesktop().catch(async (error) => {
    await dialog.showErrorBox(
      "镜头沙盘启动失败",
      error instanceof Error ? error.message : String(error),
    );
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  localServer?.close();
  app.quit();
});
