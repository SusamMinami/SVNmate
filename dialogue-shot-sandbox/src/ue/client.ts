import type {
  BlueprintFormationSnapshot,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
} from "../types";

export interface BlueprintFormationLookup {
  status: "found" | "not_found" | "editor_offline" | "unavailable";
  message: string;
  snapshot?: BlueprintFormationSnapshot;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { message?: string };
}

const FORMATION_LOOKUP_TIMEOUT_MS = 10_000;

async function fetchUe(
  path: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = timeoutMs ? new AbortController() : null;
    const timeout = controller
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      return await fetch(path, {
        ...init,
        signal: controller?.signal ?? init.signal,
      });
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (attempt === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
    } finally {
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    }
  }
  throw lastError;
}

function bridgeUnavailableMessage(): string {
  if (window.location.protocol === "file:") {
    return "不能直接打开 HTML 文件使用 UE 功能，请通过镜头沙盘开发服务或桌面版启动";
  }
  return `无法连接 ${window.location.origin} 的 UE 桥接服务，请刷新页面并确认镜头沙盘服务仍在运行`;
}

export async function getBlueprintFormation(input: {
  dialogueId: string;
  startId: string;
  formationClassPath?: string;
}): Promise<BlueprintFormationLookup> {
  let response: Response;
  try {
    response = await fetchUe(
      "/api/ue/formation/read",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      FORMATION_LOOKUP_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      status: "unavailable",
      message:
        error instanceof DOMException && error.name === "AbortError"
          ? "Blueprint 查询超时"
          : bridgeUnavailableMessage(),
    };
  }
  const body = (await response.json().catch(() => null)) as
    | ApiEnvelope<BlueprintFormationLookup>
    | null;
  if (!response.ok || !body?.ok || !body.data) {
    return {
      status: "unavailable",
      message:
        body?.error?.message ||
        `Blueprint 查询失败（HTTP ${response.status}）`,
    };
  }
  return body.data;
}

async function postUe<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetchUe(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(bridgeUnavailableMessage());
  }
  const result = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | null;
  if (!response.ok || !result?.ok || !result.data) {
    throw new Error(
      result?.error?.message || `UE 集成操作失败（HTTP ${response.status}）`,
    );
  }
  return result.data;
}

export function loadMissionTargetPreview(
  plan: MissionTargetPreviewPlan,
): Promise<MissionTargetPreviewLoadResult> {
  return postUe("/api/ue/mission-targets/load", plan);
}

export function clearMissionTargetPreview(): Promise<{
  clearedCount: number;
}> {
  return postUe("/api/ue/mission-targets/clear");
}
