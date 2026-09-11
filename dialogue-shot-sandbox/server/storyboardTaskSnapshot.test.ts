import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDatabase } from "../src/data/demo";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import { createDirectorInput } from "../src/director/contracts";
import {
  readStoryboardTaskSnapshot,
  type StoryboardTask,
  type StoryboardTaskStatus,
} from "./storyboardTaskStore";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    readdir: vi.fn(actual.readdir),
  };
});

let root = "";
let directory = "";
const input = createDirectorInput(findDialogueSequence(demoDatabase, "2048"), "snapshot");
const now = Date.parse("2026-09-11T12:00:00Z");

async function seed(status: StoryboardTaskStatus, overrides: Partial<StoryboardTask> = {}) {
  const task: StoryboardTask = {
    requestId: status,
    status,
    createdAt: new Date(now - 60_000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    input: { ...input, request_id: status },
    ...overrides,
  };
  await fs.writeFile(join(directory, `${task.requestId}.json`), JSON.stringify(task));
  return task;
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "storyboard-snapshot-"));
  directory = join(root, ".storyboard-data", "tasks");
  await fs.mkdir(directory, { recursive: true });
  vi.stubEnv("STORYBOARD_PROJECT_ROOT", root);
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

describe("readStoryboardTaskSnapshot", () => {
  it("reads each task once and shares queue ordering with all status counters", async () => {
    await seed("pending", { requestId: "pending-a", queueOrder: 2 });
    await seed("pending", { requestId: "pending-b", queueOrder: 1 });
    await seed("processing", { claimedAt: new Date(now).toISOString() });
    await seed("completed");
    await seed("failed");
    await seed("cancelled");
    await fs.writeFile(join(directory, "uncommitted.tmp"), "not a task");
    const snapshot = await readStoryboardTaskSnapshot();
    expect(snapshot.stats).toEqual({
      pending: 2, processing: 1, completed: 1, failed: 1, cancelled: 1,
    });
    expect(snapshot.tasks.map((task) => task.requestId))
      .toEqual(["pending-b", "pending-a", "processing"]);
    expect(snapshot.tasks[0]).toMatchObject({
      dialogueId: input.dialogue_prefix,
      dialogueCount: input.dialogue.length,
      firstLine: input.dialogue[0].content,
    });
    expect(snapshot.tasks[0]).not.toHaveProperty("input");
    expect(fs.readdir).toHaveBeenCalledTimes(1);
    expect(fs.readFile).toHaveBeenCalledTimes(6);
  });

  it("returns zero counters and no active tasks for an empty directory", async () => {
    expect(await readStoryboardTaskSnapshot()).toEqual({
      tasks: [],
      stats: { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 },
    });
    expect(fs.readdir).toHaveBeenCalledTimes(1);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("rereads only expired leases and includes cancellation in the same snapshot", async () => {
    await seed("processing", { claimedAt: new Date(now - 360_000).toISOString() });
    await seed("completed");
    const snapshot = await readStoryboardTaskSnapshot();
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.stats).toMatchObject({ processing: 0, cancelled: 1, completed: 1 });
    expect(fs.readdir).toHaveBeenCalledTimes(1);
    expect(fs.readFile).toHaveBeenCalledTimes(3);
    expect(JSON.parse(await fs.readFile(join(directory, "processing.json"), "utf8")))
      .toMatchObject({ status: "cancelled", error: "TRAE 处理心跳已中断，任务已自动结束" });
  });

  it("preserves a lease renewed after the initial read but before the lock", async () => {
    const stale = await seed("processing", {
      claimedAt: new Date(now - 360_000).toISOString(),
    });
    const renewed = { ...stale, leaseUpdatedAt: new Date(now).toISOString() };
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(fs.readFile).mockImplementationOnce(async (...args) => {
      const value = await actual.readFile(...args);
      await fs.writeFile(join(directory, "processing.json"), JSON.stringify(renewed));
      return value;
    });
    const snapshot = await readStoryboardTaskSnapshot();
    expect(snapshot.stats).toMatchObject({ processing: 1, cancelled: 0 });
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0].updatedAt).toBe(renewed.leaseUpdatedAt);
    expect(fs.readFile).toHaveBeenCalledTimes(2);
  });

  it("does not retain stale results between reads or across runtime roots", async () => {
    await seed("pending");
    expect((await readStoryboardTaskSnapshot()).stats.pending).toBe(1);
    await fs.unlink(join(directory, "pending.json"));
    await seed("completed");
    expect((await readStoryboardTaskSnapshot()).stats).toMatchObject({ pending: 0, completed: 1 });
    vi.stubEnv("STORYBOARD_PROJECT_ROOT", join(root, "other-runtime"));
    expect((await readStoryboardTaskSnapshot()).stats.completed).toBe(0);
  });

  it("reports corrupt task files instead of silently undercounting", async () => {
    await fs.writeFile(join(directory, "broken.json"), "{");
    await expect(readStoryboardTaskSnapshot()).rejects.toBeInstanceOf(SyntaxError);
  });
});
