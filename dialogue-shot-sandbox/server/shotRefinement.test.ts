import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createStoryboardMcpServer } from "../mcp/storyboardServer";
import { routeTraeRequest } from "./traeBridge";
import { demoDatabase } from "../src/data/demo";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import { createShotPreview } from "../src/director/shotPlanner";
import { createShotRefinementRequest, refinementBaselinePlan } from "../src/director/shotRefinement";
import {
  createShotRefinementTask, createStoryboardTask, claimPendingStoryboardTask,
  completeStoryboardTask, cancelStoryboardTask, getStoryboardTask,
} from "./storyboardTaskStore";

let root = "";
const previousRoot = process.env.STORYBOARD_PROJECT_ROOT;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "shot-refinement-"));
  process.env.STORYBOARD_PROJECT_ROOT = root;
});
afterEach(async () => {
  if (previousRoot === undefined) delete process.env.STORYBOARD_PROJECT_ROOT;
  else process.env.STORYBOARD_PROJECT_ROOT = previousRoot;
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});
function request() {
  const preview = createShotPreview(findDialogueSequence(demoDatabase, "2048"));
  return createShotRefinementRequest(preview.sequence, preview.shots, [0],
    "保留双方空间关系", preview.blocking, preview.analysis);
}

describe("refinement queue isolation", () => {
  it("creates and polls a local refinement through the HTTP bridge", async () => {
    const server = createServer(async (req, res) => {
      if (!await routeTraeRequest(req, res)) { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const refinement = request();
      const response = await fetch(`${baseUrl}/api/trae/refinements`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(refinement),
      });
      const created = await response.json();
      expect(created.ok).toBe(true);
      expect(created.data.baselineVersion).toMatch(/^[a-f0-9]{64}$/);
      await claimPendingStoryboardTask();
      await completeStoryboardTask(created.data.requestId, refinementBaselinePlan(refinement));
      const status = await fetch(`${baseUrl}/api/trae/refinements/status?request_id=${created.data.requestId}`);
      expect(await status.json()).toMatchObject({ ok: true, data: {
        status: "completed", baselineVersion: created.data.baselineVersion,
        result: { request_id: refinement.input.request_id },
      } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("never reuses or propagates a full-plan result into refinement tasks", async () => {
    const refinement = request();
    const full = await createStoryboardTask({ ...refinement.input, request_id: "full" });
    await claimPendingStoryboardTask();
    await completeStoryboardTask(full.requestId, { ...refinementBaselinePlan(refinement), request_id: "full" });
    const local = await createShotRefinementTask(refinement);
    expect(local.status).toBe("pending");
    expect(local.cacheKey).not.toBe(full.cacheKey);
    await claimPendingStoryboardTask();
    await completeStoryboardTask(local.requestId, refinementBaselinePlan(refinement));
    const another = await createStoryboardTask({ ...refinement.input, request_id: "full-again" });
    expect(another.requestId).toBe("full");
    expect((await getStoryboardTask(local.requestId))?.cachePropagationDisabled).toBe(true);
  });

  it("rejects changed blocking, untouched shots and late completion after cancellation", async () => {
    const refinement = request();
    const task = await createShotRefinementTask(refinement);
    await claimPendingStoryboardTask();
    const changedBlocking = refinementBaselinePlan(refinement);
    changedBlocking.blocking = { ...changedBlocking.blocking, intent: "移动全场" };
    await expect(completeStoryboardTask(task.requestId, changedBlocking)).rejects.toThrow("不能改动");
    const changedOther = refinementBaselinePlan(refinement);
    changedOther.shots[1] = { ...changedOther.shots[1], intent: "越界改写" };
    await expect(completeStoryboardTask(task.requestId, changedOther)).rejects.toThrow("不能改动");
    await cancelStoryboardTask(task.requestId);
    await expect(completeStoryboardTask(task.requestId, refinementBaselinePlan(refinement))).rejects.toThrow("中断");
    expect((await getStoryboardTask(task.requestId))?.status).toBe("cancelled");
  });

  it("claims a compact MCP packet and accepts only a versioned patch", async () => {
    const refinement = request();
    await createShotRefinementTask(refinement);
    const server = createStoryboardMcpServer();
    const client = new Client({ name: "refinement-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const claimed = await client.callTool({ name: "storyboard_get_pending_request", arguments: {} });
      const packet = claimed.structuredContent as { task_type: string; request: { baseline_version: string; shots: unknown[] } };
      expect(packet.task_type).toBe("refine_shots");
      expect(packet.request.shots).toHaveLength(2);
      const oldSubmit = await client.callTool({ name: "storyboard_submit_plan", arguments: {
        request_id: refinement.input.request_id, plan: refinementBaselinePlan(refinement),
      } });
      expect(oldSubmit.isError).toBe(true);
      const stale = await client.callTool({ name: "storyboard_submit_shot_patch", arguments: {
        request_id: refinement.input.request_id, patch: {
          baseline_version: "f".repeat(64), replacements: [{ shot_index: 0, decision: refinement.baseline.shots[0].decision }],
        },
      } });
      expect(stale.isError).toBe(true);
      expect((await getStoryboardTask(refinement.input.request_id))?.status).toBe("processing");
      const submitted = await client.callTool({ name: "storyboard_submit_shot_patch", arguments: {
        request_id: refinement.input.request_id, patch: {
          baseline_version: packet.request.baseline_version,
          replacements: [{ shot_index: 0, decision: { ...refinement.baseline.shots[0].decision, intent: "明确双方的交流空间。" } }],
        },
      } });
      expect(submitted.isError).not.toBe(true);
      expect(submitted.structuredContent).toMatchObject({ accepted: true });
      expect((await getStoryboardTask(refinement.input.request_id))?.result?.status).toBe("ready");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
