import type {
  DirectorInput,
  ReadyDirectorResponse,
} from "../director/contracts";

export interface TraePendingTask {
  requestId: string;
  dialogueId: string;
  outline: string;
  firstLine: string;
  dialogueCount: number;
  participantNames: string[];
  createdAt: string;
}

export interface TraeCollaborationStatus {
  configured: boolean;
  connected: boolean;
  versionMismatch: boolean;
  expectedVersion: string;
  serverVersion: string | null;
  transport: "http" | "stdio" | null;
  lastSeenAt: string | null;
  mcpName: string;
  mcpConfigPath: string;
  skillName: string;
  stats: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  queue?: TraePendingTask[];
}

export interface TraeMcpConfig {
  config: Record<string, unknown>;
  configText: string;
  configPath: string;
  instructions: string[];
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: {
    message?: string;
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("内部 TRAE 协作服务未启动");
  }
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.ok || body.data === undefined) {
    throw new Error(
      body?.error?.message ||
        `内部 TRAE 协作服务失败（HTTP ${response.status}）`,
    );
  }
  return body.data;
}

export function getTraeStatus(): Promise<TraeCollaborationStatus> {
  return api<TraeCollaborationStatus>("/api/trae/status");
}

export function getTraeMcpConfig(): Promise<TraeMcpConfig> {
  return api<TraeMcpConfig>("/api/trae/mcp-config");
}

export function reorderTraeQueue(
  requestIds: string[],
): Promise<TraePendingTask[]> {
  return api<TraePendingTask[]>("/api/trae/queue/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_ids: requestIds }),
  });
}

export function deleteTraeQueueItem(
  requestId: string,
): Promise<{ requestId: string }> {
  return api("/api/trae/queue/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId }),
  });
}

export function resolveSharedStoryboardConflict(
  choice: "local" | "shared",
  recordId: string,
  input: DirectorInput,
  plan: ReadyDirectorResponse,
): Promise<{ accepted: true; choice: "local" | "shared"; record_id: string }> {
  return api("/api/trae/shared/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      choice,
      record_id: recordId,
      input,
      plan,
    }),
  });
}
