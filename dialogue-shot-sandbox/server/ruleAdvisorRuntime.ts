import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_OLLAMA_HOST = "127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3-vl:4b";
let managedProcess: ChildProcess | null = null;
let managedStart: Promise<boolean> | null = null;
let activeResourceUsers = 0;
let releaseGeneration = 0;
let modelReleaseTimer: NodeJS.Timeout | null = null;
let runtimeReleaseTimer: NodeJS.Timeout | null = null;
let modelUnloadController: AbortController | null = null;

export interface RuleAdvisorModelSnapshot {
  state:
    | "checking"
    | "missing_runtime"
    | "missing_model"
    | "downloading"
    | "ready"
    | "error";
  model: string;
  runtimeAvailable: boolean;
  serviceAvailable: boolean;
  modelInstalled: boolean;
  modelDirectory?: string;
  percent?: number;
  message: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function serviceAvailable(host: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(`http://${host}/api/version`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function executableCandidates(
  bundledExecutable?: string,
): Promise<string[]> {
  const localAppData = process.env.LOCALAPPDATA || "";
  const configured = process.env.RULE_ADVISOR_RUNTIME_PATH || "";
  const candidates = [
    configured,
    bundledExecutable || "",
    join(localAppData, "Programs", "Ollama", "ollama.exe"),
  ].filter(Boolean);
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) existing.push(candidate);
  }
  return existing;
}

async function installedModels(host: string): Promise<string[]> {
  try {
    const response = await fetch(`http://${host}/api/tags`);
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    return (payload.models ?? []).flatMap((item) => [
      item.name || "",
      item.model || "",
    ]);
  } catch {
    return [];
  }
}

function configuredModel(): string {
  return process.env.RULE_ADVISOR_MODEL || DEFAULT_MODEL;
}

export function configuredModelDirectory(): string {
  const configured = process.env.OLLAMA_MODELS?.trim();
  if (configured) {
    return configured;
  }
  const userProfile = process.env.USERPROFILE?.trim();
  return userProfile ? join(userProfile, ".ollama", "models") : "";
}

function modelManifestSegments(model: string): string[] {
  const separator = model.lastIndexOf(":");
  const name = separator >= 0 ? model.slice(0, separator) : model;
  const tag = separator >= 0 ? model.slice(separator + 1) : "latest";
  const nameSegments = name.split("/").filter(Boolean);
  if (nameSegments.length === 1) {
    return ["registry.ollama.ai", "library", nameSegments[0], tag];
  }
  if (nameSegments.length === 2) {
    return ["registry.ollama.ai", ...nameSegments, tag];
  }
  return [...nameSegments, tag];
}

async function locallyInstalledModel(model: string): Promise<boolean> {
  const modelDirectory = configuredModelDirectory();
  return Boolean(
    modelDirectory &&
      await pathExists(
        join(
          modelDirectory,
          "manifests",
          ...modelManifestSegments(model),
        ),
      ),
  );
}

function configuredIdleMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clearResourceReleaseTimers(): void {
  if (modelReleaseTimer) {
    clearTimeout(modelReleaseTimer);
    modelReleaseTimer = null;
  }
  if (runtimeReleaseTimer) {
    clearTimeout(runtimeReleaseTimer);
    runtimeReleaseTimer = null;
  }
  modelUnloadController?.abort();
  modelUnloadController = null;
}

export function ruleAdvisorKeepAlive(): string {
  const idleMs = configuredIdleMs(
    "RULE_ADVISOR_MODEL_IDLE_MS",
    60_000,
  );
  return `${Math.max(1, Math.ceil(idleMs / 1_000))}s`;
}

async function unloadRuleAdvisorModel(generation: number): Promise<void> {
  if (
    generation !== releaseGeneration ||
    activeResourceUsers > 0 ||
    process.env.RULE_ADVISOR_API_STYLE === "openai"
  ) {
    return;
  }
  const controller = new AbortController();
  modelUnloadController = controller;
  const host = process.env.RULE_ADVISOR_OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
  try {
    const response = await fetch(`http://${host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: configuredModel(),
        keep_alive: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    await response.text();
  } catch {
    // A stopped or externally managed runtime needs no further cleanup.
  } finally {
    if (modelUnloadController === controller) {
      modelUnloadController = null;
    }
  }
}

export function retainRuleAdvisorResources(): void {
  activeResourceUsers += 1;
  releaseGeneration += 1;
  clearResourceReleaseTimers();
}

export function releaseRuleAdvisorResources(): void {
  activeResourceUsers = Math.max(0, activeResourceUsers - 1);
  if (activeResourceUsers > 0) {
    return;
  }
  clearResourceReleaseTimers();
  const generation = ++releaseGeneration;
  const modelIdleMs = configuredIdleMs(
    "RULE_ADVISOR_MODEL_IDLE_MS",
    60_000,
  );
  const runtimeIdleMs = configuredIdleMs(
    "RULE_ADVISOR_RUNTIME_IDLE_MS",
    600_000,
  );
  modelReleaseTimer = setTimeout(() => {
    modelReleaseTimer = null;
    void unloadRuleAdvisorModel(generation);
  }, modelIdleMs);
  modelReleaseTimer.unref();
  runtimeReleaseTimer = setTimeout(() => {
    runtimeReleaseTimer = null;
    if (
      generation === releaseGeneration &&
      activeResourceUsers === 0 &&
      managedProcess &&
      !managedProcess.killed
    ) {
      managedProcess.kill();
      managedProcess = null;
    }
  }, Math.max(modelIdleMs, runtimeIdleMs));
  runtimeReleaseTimer.unref();
}

export async function releaseIdleRuleAdvisorResourcesNow(): Promise<boolean> {
  if (activeResourceUsers > 0) {
    return false;
  }
  clearResourceReleaseTimers();
  const generation = ++releaseGeneration;
  await unloadRuleAdvisorModel(generation);
  const runtimeIdleMs = configuredIdleMs(
    "RULE_ADVISOR_RUNTIME_IDLE_MS",
    600_000,
  );
  runtimeReleaseTimer = setTimeout(() => {
    runtimeReleaseTimer = null;
    if (
      generation === releaseGeneration &&
      activeResourceUsers === 0 &&
      managedProcess &&
      !managedProcess.killed
    ) {
      managedProcess.kill();
      managedProcess = null;
    }
  }, runtimeIdleMs);
  runtimeReleaseTimer.unref();
  return true;
}

export async function inspectRuleAdvisorModel(options: {
  bundledExecutable?: string;
} = {}): Promise<RuleAdvisorModelSnapshot> {
  const model = configuredModel();
  const host = process.env.RULE_ADVISOR_OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
  const candidates = await executableCandidates(options.bundledExecutable);
  const executableAvailable = candidates.length > 0;
  const serviceReady = await serviceAvailable(host);
  const modelDirectory = configuredModelDirectory();
  const localModelInstalled =
    !serviceReady && await locallyInstalledModel(model);
  if (!serviceReady && !executableAvailable) {
    return {
      state: "missing_runtime",
      model,
      runtimeAvailable: false,
      serviceAvailable: false,
      modelInstalled: localModelInstalled,
      modelDirectory,
      message: localModelInstalled
        ? "模型已存在，但需要先安装 Ollama 运行时"
        : "需要先安装 Ollama 运行时",
    };
  }
  if (!serviceReady) {
    return {
      state: localModelInstalled ? "ready" : "missing_model",
      model,
      runtimeAvailable: true,
      serviceAvailable: false,
      modelInstalled: localModelInstalled,
      modelDirectory,
      message: localModelInstalled
        ? "端侧导演模型已安装，推理时自动启动"
        : "运行时已安装，下载模型时会自动启动",
    };
  }
  const modelInstalled = (await installedModels(host)).includes(model);
  return {
    state: modelInstalled ? "ready" : "missing_model",
    model,
    runtimeAvailable: true,
    serviceAvailable: true,
    modelInstalled,
    modelDirectory,
    message: modelInstalled
      ? "端侧导演模型已就绪"
      : "模型尚未下载，规则导演仍可独立使用",
  };
}

async function downloadRuleAdvisorModelImpl(
  options: {
    bundledExecutable?: string;
    onProgress?: (snapshot: RuleAdvisorModelSnapshot) => void;
  } = {},
): Promise<RuleAdvisorModelSnapshot> {
  const model = configuredModel();
  const host = process.env.RULE_ADVISOR_OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
  const runtimeAvailable = await ensureRuleAdvisorRuntime({
    bundledExecutable: options.bundledExecutable,
  });
  if (!runtimeAvailable) {
    throw new Error("未检测到 Ollama，请先安装运行时");
  }
  if ((await installedModels(host)).includes(model)) {
    return {
      state: "ready",
      model,
      runtimeAvailable: true,
      serviceAvailable: true,
      modelInstalled: true,
      modelDirectory: configuredModelDirectory(),
      percent: 100,
      message: "端侧导演模型已就绪",
    };
  }
  const initial: RuleAdvisorModelSnapshot = {
    state: "downloading",
    model,
    runtimeAvailable: true,
    serviceAvailable: true,
    modelInstalled: false,
    modelDirectory: configuredModelDirectory(),
    percent: 0,
    message: "正在准备模型下载",
  };
  options.onProgress?.(initial);
  const response = await fetch(`http://${host}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`模型下载服务返回 HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let lastPercent = 0;
  while (true) {
    const { value, done } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split(/\r?\n/);
    buffered = done ? "" : lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as {
        status?: string;
        total?: number;
        completed?: number;
        error?: string;
      };
      if (event.error) throw new Error(event.error);
      const percent =
        event.total && event.completed !== undefined
          ? Math.min(100, Math.round((event.completed / event.total) * 100))
          : lastPercent;
      lastPercent = Math.max(lastPercent, percent);
      options.onProgress?.({
        ...initial,
        percent: lastPercent,
        message: event.status || "正在下载模型",
      });
    }
    if (done) break;
  }
  if (!(await installedModels(host)).includes(model)) {
    throw new Error("模型下载完成，但 Ollama 未返回已安装模型");
  }
  return {
    state: "ready",
    model,
    runtimeAvailable: true,
    serviceAvailable: true,
    modelInstalled: true,
    modelDirectory: configuredModelDirectory(),
    percent: 100,
    message: "端侧导演模型已就绪",
  };
}

export async function downloadRuleAdvisorModel(
  options: {
    bundledExecutable?: string;
    onProgress?: (snapshot: RuleAdvisorModelSnapshot) => void;
  } = {},
): Promise<RuleAdvisorModelSnapshot> {
  retainRuleAdvisorResources();
  try {
    return await downloadRuleAdvisorModelImpl(options);
  } finally {
    releaseRuleAdvisorResources();
  }
}

export async function ensureRuleAdvisorRuntime(options: {
  bundledExecutable?: string;
} = {}): Promise<boolean> {
  if (
    process.env.RULE_ADVISOR_ENABLED === "0" ||
    process.env.RULE_ADVISOR_API_STYLE === "openai"
  ) {
    return false;
  }
  const host = process.env.RULE_ADVISOR_OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
  if (await serviceAvailable(host)) {
    return true;
  }
  if (managedStart) {
    return managedStart;
  }
  const executable = (await executableCandidates(options.bundledExecutable))[0];
  if (!executable) {
    return false;
  }

  managedStart = (async () => {
    managedProcess = spawn(executable, ["serve"], {
      env: {
        ...process.env,
        OLLAMA_HOST: host,
      },
      stdio: "ignore",
      windowsHide: true,
    });
    managedProcess.once("exit", () => {
      managedProcess = null;
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 250),
      );
      if (await serviceAvailable(host)) {
        return true;
      }
    }
    return false;
  })();
  try {
    return await managedStart;
  } finally {
    managedStart = null;
  }
}

export function stopManagedRuleAdvisorRuntime(): void {
  activeResourceUsers = 0;
  releaseGeneration += 1;
  clearResourceReleaseTimers();
  if (managedProcess && !managedProcess.killed) {
    managedProcess.kill();
  }
  managedProcess = null;
  managedStart = null;
}
