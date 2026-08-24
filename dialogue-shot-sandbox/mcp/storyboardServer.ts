#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  MiraDirectorResponseSchema,
  MiraReadyResponseSchema,
} from "../src/director/contracts";
import { inspectDirectorProjection } from "../src/director/orchestrator";
import {
  recordStoryboardMcpActivity,
  startStoryboardMcpHeartbeat,
  STORYBOARD_MCP_VERSION,
} from "../server/storyboardMcpHeartbeat";
import {
  claimPendingStoryboardTask,
  completeStoryboardTask,
  failStoryboardTask,
  getStoryboardTask,
  recordStoryboardProjectionRevision,
} from "../server/storyboardTaskStore";
import {
  findRelevantStoryboardCases,
  saveStoryboardRevisionCases,
  type StoryboardRevisionReference,
} from "../server/storyboardCaseLibrary";
import { runLark } from "../server/larkBridge";

const MAX_PROJECTION_REVISION_ATTEMPTS = 1;

export function createStoryboardMcpServer(): McpServer {
  const server = new McpServer({
    name: "internal-storyboard-collaboration",
    version: STORYBOARD_MCP_VERSION,
  });

  server.registerTool(
  "storyboard_get_pending_request",
  {
    description:
      "领取镜头沙盘中最早的待处理分镜任务。返回完整对话、NPC设定、允许的镜头模板与输出约束。",
    inputSchema: {},
  },
  async () => {
    const task = await claimPendingStoryboardTask();
    const result = task
      ? {
          found: true,
          request_id: task.requestId,
          request: task.input,
        }
      : {
          found: false,
          message: "当前没有待处理的分镜任务",
        };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
);

  server.registerTool(
  "storyboard_submit_plan",
  {
    description:
      "提交内部 TRAE 设计完成的 shot-plan.v5。服务端会校验 request_id、Schema、动态关系轴、构图语义、焦段意图、镜内运动、单人/多人覆盖策略、镜头模板、字段范围和实际投影；首次投影失败会返回 failed_shots，要求定向返修后再次提交。",
    inputSchema: {
      request_id: z.string().min(1),
      plan: z.record(z.string(), z.unknown()),
      revision_attempt: z.literal(1).optional(),
    },
  },
  async ({ request_id, plan, revision_attempt }) => {
    const parsedPlan = MiraDirectorResponseSchema.parse(plan);
    if (parsedPlan.request_id !== request_id) {
      throw new Error("提交结果的 request_id 与任务不一致");
    }
    const sourceTask = await getStoryboardTask(request_id);
    if (!sourceTask) {
      throw new Error(`未找到分镜任务 ${request_id}`);
    }
    let acceptedPlan = parsedPlan;
    let projectionFailures: ReturnType<typeof inspectDirectorProjection> = [];
    let originalProjectionFailures: ReturnType<
      typeof inspectDirectorProjection
    > = [];
    let referenceCases: StoryboardRevisionReference[] = [];
    if (revision_attempt !== undefined) {
      if (parsedPlan.status !== "ready") {
        throw new Error("投影返修只接受 ready 状态的完整方案");
      }
      if (
        revision_attempt !== MAX_PROJECTION_REVISION_ATTEMPTS ||
        (sourceTask.projectionRevisionAttempts ?? 0) <
          MAX_PROJECTION_REVISION_ATTEMPTS ||
        !sourceTask.projectionRevisionBase ||
        !sourceTask.projectionRevisionFailedShotIndexes
      ) {
        throw new Error("当前任务尚未发出对应的投影返修请求");
      }
      const failedIndexes = new Set(
        sourceTask.projectionRevisionFailedShotIndexes,
      );
      acceptedPlan = MiraReadyResponseSchema.parse({
        ...sourceTask.projectionRevisionBase,
        request_id,
        shots: sourceTask.projectionRevisionBase.shots.map((shot, index) =>
          failedIndexes.has(index)
            ? (parsedPlan.shots[index] ?? shot)
            : shot,
        ),
        revision_reflections: parsedPlan.revision_reflections,
      });
      originalProjectionFailures = inspectDirectorProjection(
        sourceTask.input,
        sourceTask.projectionRevisionBase,
      );
      projectionFailures = inspectDirectorProjection(
        sourceTask.input,
        acceptedPlan,
      );
      referenceCases = await findRelevantStoryboardCases(
        sourceTask.input,
        originalProjectionFailures,
        runLark,
      ).catch(() => []);
    } else if (parsedPlan.status === "ready") {
      projectionFailures = inspectDirectorProjection(
        sourceTask.input,
        parsedPlan,
      );
      if (projectionFailures.length > 0) {
        referenceCases = await findRelevantStoryboardCases(
          sourceTask.input,
          projectionFailures,
          runLark,
        ).catch(() => []);
        const revisionAttempt =
          await recordStoryboardProjectionRevision(
            request_id,
            parsedPlan,
            projectionFailures.map((failure) => failure.shotIndex - 1),
          );
        const result = {
          accepted: false,
          retry_required: true,
          request_id,
          revision_attempt: revisionAttempt,
          message:
            "投影验收未通过。请保留其他镜头，只重新设计下列失败镜头后再次提交完整方案。",
          failed_shots: projectionFailures.map((failure) => ({
            shot_index: failure.shotIndex,
            dialogue_ids: failure.dialogueIds,
            warnings: failure.warnings,
            previous_decision: failure.decision,
          })),
          reference_cases: referenceCases,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      }
    }

    const task = await completeStoryboardTask(request_id, acceptedPlan);
    if (
      revision_attempt !== undefined &&
      acceptedPlan.status === "ready" &&
      sourceTask.projectionRevisionBase &&
      sourceTask.input.constraints.collect_revision_cases !== false
    ) {
      await saveStoryboardRevisionCases(
        sourceTask.input,
        sourceTask.projectionRevisionBase,
        acceptedPlan,
        originalProjectionFailures,
        projectionFailures,
        "TRAE 协作",
        referenceCases,
        runLark,
      ).catch((error) => {
        console.error("[storyboard-case-library] upload failed", error);
      });
    }
    const result = {
      accepted: true,
      request_id: task.requestId,
      status: task.status,
      projection_validation:
        projectionFailures.length === 0 ? "passed" : "failed_after_retry",
      remaining_failed_shots: projectionFailures.map((failure) => ({
        shot_index: failure.shotIndex,
        dialogue_ids: failure.dialogueIds,
        warnings: failure.warnings,
      })),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
);

  server.registerTool(
  "storyboard_fail_request",
  {
    description:
      "当任务无法完成时记录失败原因，使镜头沙盘停止等待并自动降级到规则导演。",
    inputSchema: {
      request_id: z.string().min(1),
      reason: z.string().min(1).max(1_000),
    },
  },
  async ({ request_id, reason }) => {
    const task = await failStoryboardTask(request_id, reason);
    const result = {
      accepted: true,
      request_id: task.requestId,
      status: task.status,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
);

  server.registerTool(
  "storyboard_get_request_status",
  {
    description: "按 request_id 查询分镜协作任务状态。",
    inputSchema: {
      request_id: z.string().min(1),
    },
  },
  async ({ request_id }) => {
    const task = await getStoryboardTask(request_id);
    const result = task
      ? {
          found: true,
          request_id: task.requestId,
          status: task.status,
          error: task.error || "",
        }
      : {
          found: false,
          request_id,
          status: "missing",
          error: "",
        };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
  );

  return server;
}

export async function runStoryboardMcpServer(): Promise<void> {
  const server = createStoryboardMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const stopHeartbeat = await startStoryboardMcpHeartbeat();
  let closing = false;
  const close = async () => {
    if (closing) {
      return;
    }
    closing = true;
    await stopHeartbeat();
    await server.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  console.error("[storyboard-mcp] ready");
}

export async function routeStoryboardMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/mcp") {
    return false;
  }
  if (request.method !== "POST") {
    response.writeHead(405, {
      "Content-Type": "application/json; charset=utf-8",
      Allow: "POST",
    });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null,
      }),
    );
    return true;
  }

  const server = createStoryboardMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
    await recordStoryboardMcpActivity("http");
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message:
              error instanceof Error
                ? error.message
                : "Internal MCP server error",
          },
          id: null,
        }),
      );
    }
  } finally {
    await transport.close();
    await server.close();
  }
  return true;
}

if (
  process.argv.some((argument) =>
    /(?:^|[\\/])storyboardServer\.(?:ts|js|mjs|cjs)$/.test(argument),
  )
) {
  runStoryboardMcpServer().catch((error) => {
    console.error("[storyboard-mcp] fatal", error);
    process.exit(1);
  });
}
