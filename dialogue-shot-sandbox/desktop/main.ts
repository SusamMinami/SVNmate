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
  screen,
  shell,
  type Rectangle,
} from "electron";
import updater from "electron-updater";
import storyboardSkill from "../../.agents/skills/internal-storyboard-director/SKILL.md";
import {
  routeStoryboardMcpRequest,
  runStoryboardMcpServer,
} from "../mcp/storyboardServer";
import { routeLarkRequest } from "../server/larkBridge";
import {
  configureConfigDocDirectory,
  configureLiveResDirectory,
  getConfigTablePaths,
} from "../server/configRepository";
import {
  isConfigCsvDirectoryReady,
  isLiveCsvDirectoryReady,
  normalizeConfigCsvDirectory,
  normalizeLiveCsvDirectory,
} from "../server/configDirectory";
import { inspectUnrealMcpConnection } from "../server/ueBridge";
import { routeUeRequest } from "../server/ue/routes";
import {
  configureUnrealMcpPort,
  getUnrealMcpEndpoint,
} from "../server/ue/transport";
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
const DEFAULT_WINDOW_MIN_WIDTH = 1080;
const DEFAULT_WINDOW_MIN_HEIGHT = 700;
const CONFIGURATION_WINDOW_WIDTH = 310;
const CONFIGURATION_WINDOW_HEIGHT = 720;
const CONFIGURATION_WINDOW_MIN_WIDTH = 280;
const CONFIGURATION_WINDOW_MIN_HEIGHT = 480;
const CONFIGURATION_WINDOW_ANIMATION_MS = 220;
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
  liveResDirectory: string;
  configDocDirectory: string;
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

interface WindowRestoreState {
  bounds: Rectangle;
  minimumSize: number[];
  maximized: boolean;
  fullScreen: boolean;
  alwaysOnTop: boolean;
  opacity: number;
}

interface ConfigurationWindowContentSize {
  width?: unknown;
  height?: unknown;
}

let mainWindow: BrowserWindow | null = null;
let localServer: Server | null = null;
let updateSnapshot: UpdateSnapshot = { state: "idle" };
let configurationWindowRestoreState: WindowRestoreState | null = null;

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
      liveResDirectory:
        typeof parsed.liveResDirectory === "string"
          ? parsed.liveResDirectory.trim()
          : "",
      configDocDirectory:
        typeof parsed.configDocDirectory === "string"
          ? parsed.configDocDirectory.trim()
          : "",
    };
  } catch {
    return {
      setupCompleted: false,
      ueMcpPort: getUnrealMcpEndpoint().port,
      liveResDirectory: "",
      configDocDirectory: "",
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

async function setupStatus() {
  const state = await readDesktopState();
  const liveCsvDirectory = normalizeLiveCsvDirectory(
    state.liveResDirectory,
  );
  const configCsvDirectory = normalizeConfigCsvDirectory(
    state.configDocDirectory,
  );
  const [
    traeExecutable,
    integration,
    presence,
    liveDataReady,
    configDataReady,
    ueConnection,
  ] =
    await Promise.all([
      detectTrae(),
      integrationStatus(),
      getStoryboardMcpPresence(),
      isLiveCsvDirectoryReady(liveCsvDirectory),
      isConfigCsvDirectoryReady(configCsvDirectory),
      inspectUnrealMcpConnection(),
    ]);
  const missionTargetTablePath = configDataReady
    ? getConfigTablePaths().missionTarget
    : "";
  return {
    firstRun:
      !state.setupCompleted ||
      (integration.exists && !integration.current),
    setupCompleted: state.setupCompleted,
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
    defaultDataReady: liveDataReady && configDataReady,
    liveDataReady,
    configDataReady,
    liveResDirectory: state.liveResDirectory,
    configDocDirectory: state.configDocDirectory,
    liveCsvDirectory,
    configCsvDirectory,
    missionTargetTablePath,
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

async function setLiveResDirectory(directoryPath: unknown) {
  const state = await readDesktopState();
  const selectedDirectory = String(directoryPath ?? "").trim();
  configureLiveResDirectory(selectedDirectory);
  const csvDirectory = normalizeLiveCsvDirectory(selectedDirectory);
  if (!(await isLiveCsvDirectoryReady(csvDirectory))) {
    configureLiveResDirectory(state.liveResDirectory);
    throw new Error(
      `所选 res 目录中缺少 Content\\Seria\\Tables\\csvdir 下的对话表、开始节点或任务表：${csvDirectory || selectedDirectory}`,
    );
  }
  await writeDesktopState({
    ...state,
    liveResDirectory: selectedDirectory,
  });
  return setupStatus();
}

async function setConfigDocDirectory(directoryPath: unknown) {
  const state = await readDesktopState();
  const selectedDirectory = String(directoryPath ?? "").trim();
  configureConfigDocDirectory(selectedDirectory);
  const csvDirectory = normalizeConfigCsvDirectory(selectedDirectory);
  if (!(await isConfigCsvDirectoryReady(csvDirectory))) {
    configureConfigDocDirectory(state.configDocDirectory);
    throw new Error(
      `所选 doc 目录中缺少 csvdir 下的 NPC、模型、目标物或地图 CSV：${csvDirectory || selectedDirectory}`,
    );
  }
  await writeDesktopState({
    ...state,
    configDocDirectory: selectedDirectory,
  });
  return setupStatus();
}

function animateWindowBounds(
  targetWindow: BrowserWindow,
  targetBounds: Rectangle,
): Promise<void> {
  const startBounds = targetWindow.getBounds();
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    const updateBounds = () => {
      if (targetWindow.isDestroyed()) {
        resolvePromise();
        return;
      }
      const progress = Math.min(
        1,
        (Date.now() - startedAt) / CONFIGURATION_WINDOW_ANIMATION_MS,
      );
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      targetWindow.setBounds({
        x: Math.round(
          startBounds.x + (targetBounds.x - startBounds.x) * eased,
        ),
        y: Math.round(
          startBounds.y + (targetBounds.y - startBounds.y) * eased,
        ),
        width: Math.round(
          startBounds.width +
            (targetBounds.width - startBounds.width) * eased,
        ),
        height: Math.round(
          startBounds.height +
            (targetBounds.height - startBounds.height) * eased,
        ),
      });
      if (progress < 1) {
        setTimeout(updateBounds, 16);
      } else {
        resolvePromise();
      }
    };
    updateBounds();
  });
}

function numericWindowDimension(
  value: unknown,
  fallback: number,
  minimum: number,
): number {
  const numericValue =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(numericValue)
    ? Math.max(minimum, Math.round(numericValue))
    : fallback;
}

async function setConfigurationWindowMode(
  enabled: boolean,
  requestedContentSize?: ConfigurationWindowContentSize,
): Promise<boolean> {
  if (!mainWindow) {
    throw new Error("镜头沙盘窗口尚未就绪");
  }
  if (enabled) {
    if (!configurationWindowRestoreState) {
      configurationWindowRestoreState = {
        bounds: mainWindow.getBounds(),
        minimumSize: mainWindow.getMinimumSize(),
        maximized: mainWindow.isMaximized(),
        fullScreen: mainWindow.isFullScreen(),
        alwaysOnTop: mainWindow.isAlwaysOnTop(),
        opacity: mainWindow.getOpacity(),
      };
    }
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }
    const currentBounds = mainWindow.getBounds();
    const currentContentBounds = mainWindow.getContentBounds();
    const workArea = screen.getDisplayMatching(
      configurationWindowRestoreState.bounds,
    ).workArea;
    const frameWidth = Math.max(
      0,
      currentBounds.width - currentContentBounds.width,
    );
    const frameHeight = Math.max(
      0,
      currentBounds.height - currentContentBounds.height,
    );
    const requestedWidth = numericWindowDimension(
      requestedContentSize?.width,
      CONFIGURATION_WINDOW_WIDTH,
      CONFIGURATION_WINDOW_MIN_WIDTH,
    );
    const requestedHeight = numericWindowDimension(
      requestedContentSize?.height,
      CONFIGURATION_WINDOW_HEIGHT,
      CONFIGURATION_WINDOW_MIN_HEIGHT,
    );
    const width = Math.min(requestedWidth + frameWidth, workArea.width);
    const height = Math.min(requestedHeight + frameHeight, workArea.height);
    const restoreBounds = configurationWindowRestoreState.bounds;
    mainWindow.setMinimumSize(
      Math.min(CONFIGURATION_WINDOW_MIN_WIDTH, width),
      Math.min(CONFIGURATION_WINDOW_MIN_HEIGHT, height),
    );
    mainWindow.setAlwaysOnTop(true, "floating");
    mainWindow.setOpacity(1);
    await animateWindowBounds(mainWindow, {
      x: Math.min(
        Math.max(
          restoreBounds.x + restoreBounds.width - width,
          workArea.x,
        ),
        workArea.x + workArea.width - width,
      ),
      y: Math.min(
        Math.max(restoreBounds.y, workArea.y),
        workArea.y + workArea.height - height,
      ),
      width,
      height,
    });
    return true;
  }

  const restoreState = configurationWindowRestoreState;
  configurationWindowRestoreState = null;
  if (restoreState) {
    await animateWindowBounds(mainWindow, restoreState.bounds);
    mainWindow.setMinimumSize(
      restoreState.minimumSize[0],
      restoreState.minimumSize[1],
    );
    mainWindow.setOpacity(restoreState.opacity);
    mainWindow.setAlwaysOnTop(restoreState.alwaysOnTop);
    if (restoreState.maximized) {
      mainWindow.maximize();
    }
    if (restoreState.fullScreen) {
      mainWindow.setFullScreen(true);
    }
  } else {
    mainWindow.setOpacity(1);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(
      DEFAULT_WINDOW_MIN_WIDTH,
      DEFAULT_WINDOW_MIN_HEIGHT,
    );
  }
  return false;
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
    if (
      !(await isLiveCsvDirectoryReady(
        normalizeLiveCsvDirectory(state.liveResDirectory),
      ))
    ) {
      throw new Error("请先选择包含实时数据的 res 目录");
    }
    if (
      !(await isConfigCsvDirectoryReady(
        normalizeConfigCsvDirectory(state.configDocDirectory),
      ))
    ) {
      throw new Error("请先选择包含配置文档的 doc 目录");
    }
    await writeDesktopState({ ...state, setupCompleted: true });
    return setupStatus();
  });
  ipcMain.handle(
    "desktop:choose-data-directory",
    async (_event, kind: unknown) => {
      if (kind !== "live" && kind !== "config") {
        throw new Error("未知的数据目录类型");
      }
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: kind === "live" ? "选择 res 目录" : "选择 doc 目录",
        properties: ["openDirectory"],
      });
      const selectedDirectory = result.filePaths[0];
      if (result.canceled || !selectedDirectory) {
        return null;
      }
      return kind === "live"
        ? setLiveResDirectory(selectedDirectory)
        : setConfigDocDirectory(selectedDirectory);
    },
  );
  ipcMain.handle(
    "desktop:set-live-data-directory",
    (_event, directoryPath: unknown) =>
      setLiveResDirectory(directoryPath),
  );
  ipcMain.handle(
    "desktop:set-config-directory",
    (_event, directoryPath: unknown) =>
      setConfigDocDirectory(directoryPath),
  );
  ipcMain.handle(
    "desktop:restore-data-directories",
    async (
      _event,
      directories: {
        liveResDirectory?: unknown;
        configDocDirectory?: unknown;
      },
    ) => {
      const state = await readDesktopState();
      const liveDirectory = String(directories?.liveResDirectory ?? "");
      const configDirectory = String(
        directories?.configDocDirectory ?? "",
      );
      configureLiveResDirectory(liveDirectory);
      configureConfigDocDirectory(configDirectory);
      await writeDesktopState({
        ...state,
        liveResDirectory: liveDirectory,
        configDocDirectory: configDirectory,
      });
      return setupStatus();
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
  ipcMain.handle(
    "desktop:set-configuration-window-mode",
    (_event, enabled: unknown, contentSize: unknown) =>
      setConfigurationWindowMode(
        enabled === true,
        contentSize && typeof contentSize === "object"
          ? contentSize as ConfigurationWindowContentSize
          : undefined,
      ),
  );
  ipcMain.handle(
    "desktop:get-configuration-window-mode",
    () => configurationWindowRestoreState !== null,
  );
  ipcMain.handle("desktop:check-update", () => checkForUpdates());
  ipcMain.handle("desktop:update-snapshot", () => updateSnapshot);
  ipcMain.handle("desktop:install-update", () => {
    if (updateSnapshot.state !== "downloaded") {
      throw new Error("更新尚未下载完成");
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
    minWidth: DEFAULT_WINDOW_MIN_WIDTH,
    minHeight: DEFAULT_WINDOW_MIN_HEIGHT,
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
    configurationWindowRestoreState = null;
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
  if (desktopState.liveResDirectory) {
    configureLiveResDirectory(desktopState.liveResDirectory);
  }
  if (desktopState.configDocDirectory) {
    configureConfigDocDirectory(desktopState.configDocDirectory);
  }
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
