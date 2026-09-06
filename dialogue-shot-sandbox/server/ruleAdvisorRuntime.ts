import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_OLLAMA_HOST = "127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3-vl:4b";
let managedProcess: ChildProcess | null = null;

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

export async function inspectRuleAdvisorModel(options: {
  bundledExecutable?: string;
} = {}): Promise<RuleAdvisorModelSnapshot> {
  const model = configuredModel();
  const host = process.env.RULE_ADVISOR_OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
  const executableAvailable =
    (await executableCandidates(options.bundledExecutable)).length > 0;
  const serviceReady = await serviceAvailable(host);
  if (!serviceReady && !executableAvailable) {
    return {
      state: "missing_runtime",
      model,
      runtimeAvailable: false,
      serviceAvailable: false,
      modelInstalled: false,
      message: "需要先安装 Ollama 运行时",
    };
  }
  if (!serviceReady) {
    return {
      state: "missing_model",
      model,
      runtimeAvailable: true,
      serviceAvailable: false,
      modelInstalled: false,
      message: "运行时已安装，下载模型时会自动启动",
    };
  }
  const modelInstalled = (await installedModels(host)).includes(model);
  return {
    state: modelInstalled ? "ready" : "missing_model",
    model,
    runtimeAvailable: true,
    serviceAvailable: true,
    modelInstalled,
    message: modelInstalled
      ? "端侧导演模型已就绪"
      : "模型尚未下载，规则导演仍可独立使用",
  };
}

export async function downloadRuleAdvisorModel(
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
    percent: 100,
    message: "端侧导演模型已就绪",
  };
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
  const executable = (await executableCandidates(options.bundledExecutable))[0];
  if (!executable) {
    return false;
  }

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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    if (await serviceAvailable(host)) {
      return true;
    }
  }
  return false;
}

export function stopManagedRuleAdvisorRuntime(): void {
  if (managedProcess && !managedProcess.killed) {
    managedProcess.kill();
  }
  managedProcess = null;
}
