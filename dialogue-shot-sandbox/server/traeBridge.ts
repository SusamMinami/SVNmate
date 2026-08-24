import { access, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import {
  DirectorInputSchema,
  MiraReadyResponseSchema,
} from "../src/director/contracts";
import { inspectDirectorProjection } from "../src/director/orchestrator";
import {
  getStoryboardMcpPresence,
  STORYBOARD_MCP_VERSION,
} from "./storyboardMcpHeartbeat";
import {
  completeStoryboardTask,
  createStoryboardTask,
  getStoryboardTask,
  storyboardTaskStats,
} from "./storyboardTaskStore";
import {
  findExactSharedStoryboard,
  findSharedStoryboardRecords,
  saveSharedStoryboard,
  sharedLibraryEnabled,
  sharedPlansEqual,
  type SharedStoryboardRecord,
} from "./storyboardSharedLibrary";

function configuredTimeout(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured >= 1_000
    ? configured
    : fallback;
}

const QUEUE_TIMEOUT_MS = configuredTimeout(
  "STORYBOARD_TRAE_QUEUE_TIMEOUT_MS",
  30 * 60_000,
);
const PROCESSING_TIMEOUT_MS = configuredTimeout(
  "STORYBOARD_TRAE_PROCESSING_TIMEOUT_MS",
  20 * 60_000,
);
const POLL_INTERVAL_MS = 700;

class TraeWaitTimeoutError extends Error {
  constructor(
    readonly code: "TRAE_QUEUE_TIMEOUT" | "TRAE_PROCESSING_TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "TraeWaitTimeoutError";
  }
}

function durationMinutes(milliseconds: number): string {
  return (milliseconds / 60_000).toLocaleString("zh-CN", {
    maximumFractionDigits: 1,
  });
}

const SharedResolutionSchema = z.object({
  choice: z.enum(["local", "shared"]),
  record_id: z.string().min(1),
  input: DirectorInputSchema,
  plan: MiraReadyResponseSchema,
});

function appRoot(): string {
  return resolve(
    process.env.STORYBOARD_PROJECT_ROOT ||
      process.cwd(),
  );
}

function workspaceRoot(): string {
  return resolve(
    process.env.STORYBOARD_WORKSPACE_ROOT ||
      join(appRoot(), ".."),
  );
}

export function storyboardMcpConfigPath(): string {
  if (process.env.STORYBOARD_MCP_CONFIG_PATH) {
    return resolve(process.env.STORYBOARD_MCP_CONFIG_PATH);
  }
  return join(workspaceRoot(), ".trae", "mcp.json");
}

export function storyboardMcpConfigTemplate() {
  const packagedUrl = process.env.STORYBOARD_MCP_URL;
  if (packagedUrl) {
    return {
      mcpServers: {
        "internal-storyboard-collaboration": {
          url: packagedUrl,
        },
      },
    };
  }
  const packagedCommand = process.env.STORYBOARD_MCP_COMMAND;
  if (packagedCommand) {
    let args = ["--storyboard-mcp"];
    try {
      const parsed = JSON.parse(
        process.env.STORYBOARD_MCP_ARGS_JSON || '["--storyboard-mcp"]',
      );
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        args = parsed;
      }
    } catch {
      // Keep the safe default argument when an override is malformed.
    }
    return {
      mcpServers: {
        "internal-storyboard-collaboration": {
          command: packagedCommand,
          args,
          env: {
            STORYBOARD_PROJECT_ROOT: appRoot(),
            START_MCP_TIMEOUT_MS: "60000",
            RUN_MCP_TIMEOUT_MS: "60000",
          },
        },
      },
    };
  }
  const sourceRoot = appRoot();
  return {
    mcpServers: {
      "internal-storyboard-collaboration": {
        command: process.execPath,
        args: [
          join(sourceRoot, "node_modules", "tsx", "dist", "cli.mjs"),
          join(sourceRoot, "mcp", "storyboardServer.ts"),
        ],
        env: {
          STORYBOARD_PROJECT_ROOT: sourceRoot,
          START_MCP_TIMEOUT_MS: "60000",
          RUN_MCP_TIMEOUT_MS: "60000",
        },
      },
    },
  };
}

async function isMcpConfigured(): Promise<boolean> {
  try {
    await access(storyboardMcpConfigPath());
    const content = await readFile(storyboardMcpConfigPath(), "utf8");
    return content.includes("internal-storyboard-collaboration");
  } catch {
    return false;
  }
}

async function collaborationStatus() {
  const [configured, presence, stats] = await Promise.all([
    isMcpConfigured(),
    getStoryboardMcpPresence(),
    storyboardTaskStats(),
  ]);
  return {
    configured,
    connected: presence.connected && presence.compatible,
    versionMismatch: presence.connected && !presence.compatible,
    expectedVersion: STORYBOARD_MCP_VERSION,
    serverVersion: presence.serverVersion,
    transport: presence.transport,
    lastSeenAt: presence.lastSeenAt,
    mcpName: "internal-storyboard-collaboration",
    mcpConfigPath: storyboardMcpConfigPath(),
    skillName: "internal-storyboard-director",
    stats,
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new Error("请求体超过 1MB 限制");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export interface CollaborationWaitOptions {
  queueTimeoutMs?: number;
  processingTimeoutMs?: number;
  pollIntervalMs?: number;
}

export async function waitForCollaborationResult(
  taskRequestId: string,
  responseRequestId = taskRequestId,
  options: CollaborationWaitOptions = {},
) {
  const queueTimeoutMs = options.queueTimeoutMs ?? QUEUE_TIMEOUT_MS;
  const processingTimeoutMs =
    options.processingTimeoutMs ?? PROCESSING_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const queueDeadline = Date.now() + queueTimeoutMs;
  let processingDeadline: number | null = null;
  while (true) {
    const task = await getStoryboardTask(taskRequestId);
    if (!task) {
      throw new Error(`内部 TRAE 协作任务 ${taskRequestId} 丢失`);
    }
    if (task.status === "completed" && task.result) {
      return { ...task.result, request_id: responseRequestId };
    }
    if (task.status === "failed") {
      throw new Error(task.error || "内部 TRAE 未能完成分镜任务");
    }
    const now = Date.now();
    if (task.status === "processing") {
      processingDeadline ??=
        Date.parse(task.claimedAt || task.updatedAt) +
        processingTimeoutMs;
      if (now >= processingDeadline) {
        throw new TraeWaitTimeoutError(
          "TRAE_PROCESSING_TIMEOUT",
          `TRAE 已领取任务，但处理超过 ${durationMinutes(processingTimeoutMs)} 分钟。任务仍保留，完成后重新分析可直接复用结果`,
        );
      }
    } else if (now >= queueDeadline) {
      throw new TraeWaitTimeoutError(
        "TRAE_QUEUE_TIMEOUT",
        `TRAE 模型排队超过 ${durationMinutes(queueTimeoutMs)} 分钟。任务仍在队列中，模型完成后重新分析可直接复用结果`,
      );
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, pollIntervalMs),
    );
  }
}

async function lookupSharedLibrary(
  input: z.infer<typeof DirectorInputSchema>,
): Promise<SharedStoryboardRecord[]> {
  try {
    return await findSharedStoryboardRecords(input);
  } catch (error) {
    console.error("[storyboard-shared-library] lookup failed", error);
    return [];
  }
}

export async function routeTraeRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const url = new URL(request.url || "/", "http://localhost");
  if (
    !url.pathname.startsWith("/api/trae") &&
    url.pathname !== "/api/director/trae"
  ) {
    return false;
  }
  try {
    if (request.method === "GET" && url.pathname === "/api/trae/status") {
      sendJson(response, 200, {
        ok: true,
        data: await collaborationStatus(),
      });
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/trae/mcp-config"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: {
          config: storyboardMcpConfigTemplate(),
          configText: JSON.stringify(storyboardMcpConfigTemplate(), null, 2),
          configPath: storyboardMcpConfigPath(),
          instructions: [
            "在 TRAE 设置中打开 MCP。",
            "将配置写入项目根目录 .trae/mcp.json，或粘贴到全局 MCP 原始配置。",
            "保存配置后启用 internal-storyboard-collaboration。",
            "若提示版本不一致，请在 TRAE 中先停用再重新启用该 MCP；刷新镜头沙盘网页不会重启 MCP 进程。",
            "在 TRAE 中输入“处理待分镜任务”。",
          ],
        },
      });
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/trae/shared/resolve"
    ) {
      const resolution = SharedResolutionSchema.parse(
        await readJson(request),
      );
      const projectionFailures = inspectDirectorProjection(
        resolution.input,
        resolution.plan,
      );
      if (projectionFailures.length > 0) {
        throw new Error(
          `所选方案仍有 ${projectionFailures.length} 个镜头未通过投影验收`,
        );
      }
      if (resolution.choice === "local") {
        await saveSharedStoryboard(
          resolution.input,
          {
            ...resolution.plan,
            request_id: resolution.input.request_id,
          },
          resolution.record_id,
        );
      } else {
        const localTask = await createStoryboardTask(resolution.input);
        await completeStoryboardTask(localTask.requestId, {
          ...resolution.plan,
          request_id: localTask.requestId,
        });
      }
      sendJson(response, 200, {
        ok: true,
        data: {
          accepted: true,
          choice: resolution.choice,
          record_id: resolution.record_id,
        },
      });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/director/trae") {
      const input = DirectorInputSchema.parse(await readJson(request));
      const task = await createStoryboardTask(input);
      const taskWasCompleted = task.status === "completed";
      const sharedRecords = await lookupSharedLibrary(input);
      const validSharedRecords = sharedRecords.filter((record) => {
        try {
          return inspectDirectorProjection(input, record.plan).length === 0;
        } catch {
          return false;
        }
      });
      const exactShared = findExactSharedStoryboard(input, validSharedRecords);
      let source: "generated" | "local-cache" | "shared-library" =
        taskWasCompleted ? "local-cache" : "generated";
      if (!taskWasCompleted && exactShared) {
        await completeStoryboardTask(task.requestId, {
          ...exactShared.plan,
          request_id: task.requestId,
        });
        source = "shared-library";
      }
      const result = await waitForCollaborationResult(
        task.requestId,
        input.request_id,
      );
      let conflict: SharedStoryboardRecord | null = null;
      if (result.status === "ready") {
        const projectionFailures = inspectDirectorProjection(input, result);
        const comparableResult = {
          ...result,
          request_id: exactShared?.plan.request_id || result.request_id,
        };
        if (projectionFailures.length > 0) {
          conflict = null;
        } else if (
          exactShared &&
          !sharedPlansEqual(comparableResult, exactShared.plan)
        ) {
          conflict = exactShared;
        } else if (!exactShared && validSharedRecords[0]) {
          conflict = validSharedRecords[0];
        } else if (!validSharedRecords[0] && sharedLibraryEnabled()) {
          try {
            await saveSharedStoryboard(input, result);
          } catch (error) {
            console.error("[storyboard-shared-library] upload failed", error);
          }
        }
      }
      sendJson(response, 200, {
        ok: true,
        data: result,
        meta: {
          source,
          task_request_id: task.requestId,
          shared_conflict: conflict
            ? {
                record_id: conflict.recordId,
                input: conflict.input,
                plan: conflict.plan,
              }
            : null,
        },
      });
      return true;
    }
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "未知内部 TRAE 协作 API" },
    });
    return true;
  } catch (error) {
    sendJson(response, 503, {
      ok: false,
      error: {
        code:
          error instanceof TraeWaitTimeoutError
            ? error.code
            : "TRAE_COLLABORATION_ERROR",
        message:
          error instanceof Error ? error.message : "内部 TRAE 协作失败",
      },
    });
    return true;
  }
}

function installMiddleware(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use(async (request, response, next) => {
    if (!(await routeTraeRequest(request, response))) {
      next();
    }
  });
}

export function traeBridgePlugin(): Plugin {
  return {
    name: "internal-trae-collaboration-bridge",
    configureServer(server) {
      installMiddleware(server);
    },
    configurePreviewServer(server) {
      installMiddleware(server);
    },
  };
}
