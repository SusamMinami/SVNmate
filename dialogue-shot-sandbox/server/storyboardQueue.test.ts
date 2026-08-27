import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoDatabase } from "../src/data/demo";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import { createDirectorInput } from "../src/director/contracts";
import {
  claimPendingStoryboardTask,
  createStoryboardTask,
  deletePendingStoryboardTask,
  listPendingStoryboardTasks,
  reorderPendingStoryboardTasks,
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
});
