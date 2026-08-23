#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
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
} from "../server/storyboardTaskStore";

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
      "提交内部 TRAE 设计完成的 shot-plan.v3。服务端会校验 request_id、Schema、动态关系轴、构图语义、镜头模板和字段范围。",
    inputSchema: {
      request_id: z.string().min(1),
      plan: z.record(z.string(), z.unknown()),
    },
  },
  async ({ request_id, plan }) => {
    const task = await completeStoryboardTask(request_id, plan);
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
