import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoDatabase } from "../src/data/demo";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import { createDirectorInput } from "../src/director/contracts";
import {
  cancelStoryboardTask,
  cancelStoryboardTaskForInput,
  claimPendingStoryboardTask,
  completeStoryboardTask,
  createStoryboardTask,
  deletePendingStoryboardTask,
  expireAbandonedProcessingTasks,
  getStoryboardTask,
  listActiveStoryboardTasks,
  listPendingStoryboardTasks,
  renewStoryboardTaskLease,
  reorderPendingStoryboardTasks,
  storyboardTaskStats,
} from "./storyboardTaskStore";

let temporaryRoot = "";
let previousProjectRoot: string | undefined;

beforeEach(async () => {
  previousProjectRoot = process.env.STORYBOARD_PROJECT_ROOT;
  temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-queue-"));
  process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
});

afterEach(async () => {
  if (previousProjectRoot === undefined) {
    delete process.env.STORYBOARD_PROJECT_ROOT;
  } else {
    process.env.STORYBOARD_PROJECT_ROOT = previousProjectRoot;
  }
  await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = "";
});

function taskInput(requestId: string) {
  return createDirectorInput(
    findDialogueSequence(demoDatabase, "2048"),
    requestId,
  );
}

describe("storyboard pending queue", () => {
  it("reorders pending tasks and claims the first item", async () => {
    await createStoryboardTask(taskInput("queue-a"), {
      forceRegenerate: true,
    });
    await createStoryboardTask(taskInput("queue-b"), {
      forceRegenerate: true,
    });
    await createStoryboardTask(taskInput("queue-c"), {
      forceRegenerate: true,
    });

    const reordered = await reorderPendingStoryboardTasks([
      "queue-c",
      "queue-a",
      "queue-b",
    ]);

    expect(reordered.map((task) => task.requestId)).toEqual([
      "queue-c",
      "queue-a",
      "queue-b",
    ]);
    expect((await claimPendingStoryboardTask())?.requestId).toBe("queue-c");
  });

  it("deletes only tasks that are still pending", async () => {
    await createStoryboardTask(taskInput("queue-delete"), {
      forceRegenerate: true,
    });
    await createStoryboardTask(taskInput("queue-processing"), {
      forceRegenerate: true,
    });
    await reorderPendingStoryboardTasks([
      "queue-processing",
      "queue-delete",
    ]);
    await claimPendingStoryboardTask();

    await expect(
      deletePendingStoryboardTask("queue-processing"),
    ).rejects.toThrow("不能从待处理队列删除");
    await deletePendingStoryboardTask("queue-delete");
    expect(await listPendingStoryboardTasks()).toEqual([]);
  });

  it("cancels a processing task and rejects a late result", async () => {
    const input = taskInput("queue-cancel-processing");
    await createStoryboardTask(input, { forceRegenerate: true });
    await claimPendingStoryboardTask();

    const cancelled = await cancelStoryboardTask(
      input.request_id,
      "用户主动中断",
    );

    expect(cancelled).toMatchObject({
      status: "cancelled",
      error: "用户主动中断",
    });
    await expect(
      completeStoryboardTask(input.request_id, {
        request_id: input.request_id,
      }),
    ).rejects.toThrow("用户主动中断");
    expect(await listActiveStoryboardTasks()).toEqual([]);
    expect(await storyboardTaskStats()).toMatchObject({
      processing: 0,
      cancelled: 1,
    });
  });

  it("expires a processing task after its heartbeat lease is lost", async () => {
    const input = taskInput("queue-stale-processing");
    await createStoryboardTask(input, { forceRegenerate: true });
    const claimed = await claimPendingStoryboardTask();
    expect(claimed?.status).toBe("processing");

    const renewed = await renewStoryboardTaskLease(input.request_id);
    expect(renewed.leaseUpdatedAt).toBeTruthy();
    await expireAbandonedProcessingTasks([renewed], 0, Date.now() + 1);

    await expect(getStoryboardTask(input.request_id)).resolves.toMatchObject({
      status: "cancelled",
      error: "TRAE 处理心跳已中断，任务已自动结束",
    });
  });

  it("cancels a deduplicated active task using the caller input", async () => {
    const original = taskInput("queue-original-request");
    const duplicate = taskInput("queue-duplicate-request");
    await createStoryboardTask(original);
    await claimPendingStoryboardTask();

    const cancelled = await cancelStoryboardTaskForInput(
      duplicate.request_id,
      duplicate,
    );

    expect(cancelled.requestId).toBe(original.request_id);
    expect(cancelled.status).toBe("cancelled");
  });
});
