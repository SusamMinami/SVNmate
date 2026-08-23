import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DirectorInputSchema,
  MiraDirectorResponseSchema,
  type DirectorInput,
  type MiraDirectorResponse,
} from "../src/director/contracts";
import { storyboardRuntimeRoot } from "./storyboardRuntime";

export type StoryboardTaskStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface StoryboardTask {
  requestId: string;
  status: StoryboardTaskStatus;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  cacheKey?: string;
  cacheSourceRequestId?: string;
  input: DirectorInput;
  result?: MiraDirectorResponse;
  error?: string;
}

const PROCESSING_LEASE_MS = 20 * 60_000;
export const STORYBOARD_CACHE_POLICY =
  "shot-plan.v5:camera-language-v2";

function taskDirectory(): string {
  return join(storyboardRuntimeRoot(), ".storyboard-data", "tasks");
}

function safeRequestId(requestId: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(requestId)) {
    throw new Error("request_id 包含不安全字符");
  }
  return requestId;
}

function taskPath(requestId: string): string {
  return join(taskDirectory(), `${safeRequestId(requestId)}.json`);
}

export function storyboardInputContentHash(input: DirectorInput): string {
  const { request_id: _requestId, ...cacheableInput } = input;
  return createHash("sha256")
    .update(JSON.stringify(sortObjectKeys(cacheableInput)))
    .digest("hex");
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortObjectKeys(item)]),
    );
  }
  return value;
}

export function storyboardInputCacheKey(input: DirectorInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        policy: STORYBOARD_CACHE_POLICY,
        contentHash: storyboardInputContentHash(input),
      }),
    )
    .digest("hex");
}

async function writeTask(task: StoryboardTask): Promise<void> {
  await mkdir(taskDirectory(), { recursive: true });
  const destination = taskPath(task.requestId);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(task, null, 2), "utf8");
  await rename(temporary, destination);
}

async function readAllTasks(): Promise<StoryboardTask[]> {
  await mkdir(taskDirectory(), { recursive: true });
  const tasks: StoryboardTask[] = [];
  for (const filename of await readdir(taskDirectory())) {
    if (!filename.endsWith(".json")) {
      continue;
    }
    tasks.push(
      JSON.parse(
        await readFile(join(taskDirectory(), filename), "utf8"),
      ) as StoryboardTask,
    );
  }
  return tasks;
}

function taskCacheKey(task: StoryboardTask): string {
  return task.cacheKey || storyboardInputCacheKey(task.input);
}

function resultForRequest(
  result: MiraDirectorResponse,
  requestId: string,
): MiraDirectorResponse {
  return { ...result, request_id: requestId };
}

async function completeMatchingActiveTasks(
  tasks: StoryboardTask[],
  cacheKey: string,
  source: StoryboardTask,
): Promise<void> {
  if (source.result?.status !== "ready") {
    return;
  }
  const timestamp = new Date().toISOString();
  await Promise.all(
    tasks
      .filter(
        (task) =>
          task.requestId !== source.requestId &&
          (task.status === "pending" || task.status === "processing") &&
          taskCacheKey(task) === cacheKey,
      )
      .map(async (task) => {
        task.status = "completed";
        task.updatedAt = timestamp;
        task.cacheKey = cacheKey;
        task.cacheSourceRequestId = source.requestId;
        task.result = resultForRequest(source.result!, task.requestId);
        task.error = undefined;
        await writeTask(task);
      }),
  );
}

export async function getStoryboardTask(
  requestId: string,
): Promise<StoryboardTask | null> {
  try {
    return JSON.parse(await readFile(taskPath(requestId), "utf8")) as StoryboardTask;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function createStoryboardTask(
  rawInput: unknown,
): Promise<StoryboardTask> {
  const input = DirectorInputSchema.parse(rawInput) as DirectorInput;
  const cacheKey = storyboardInputCacheKey(input);
  const tasks = await readAllTasks();
  const existing = tasks.find(
    (task) => task.requestId === input.request_id,
  );
  const cached = tasks
    .filter(
      (task) =>
        task.status === "completed" &&
        task.result?.status === "ready" &&
        task.cacheKey === cacheKey,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (cached) {
    cached.cacheKey = cacheKey;
    await completeMatchingActiveTasks(tasks, cacheKey, cached);
    if (
      existing?.status === "pending" ||
      existing?.status === "processing"
    ) {
      return (await getStoryboardTask(existing.requestId)) ?? cached;
    }
    return existing?.status === "completed" ? existing : cached;
  }
  if (existing) {
    return existing;
  }
  const active = tasks
    .filter(
      (task) =>
        (task.status === "pending" || task.status === "processing") &&
        taskCacheKey(task) === cacheKey,
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
  if (active) {
    return active;
  }
  const timestamp = new Date().toISOString();
  const task: StoryboardTask = {
    requestId: input.request_id,
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
    cacheKey,
    input,
  };
  await writeTask(task);
  return task;
}

function processingLeaseExpired(task: StoryboardTask): boolean {
  if (task.status !== "processing" || !task.claimedAt) {
    return false;
  }
  return Date.now() - Date.parse(task.claimedAt) > PROCESSING_LEASE_MS;
}

export async function claimPendingStoryboardTask(): Promise<StoryboardTask | null> {
  await mkdir(taskDirectory(), { recursive: true });
  const filenames = (await readdir(taskDirectory()))
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  const tasks: StoryboardTask[] = [];
  for (const filename of filenames) {
    const task = JSON.parse(
      await readFile(join(taskDirectory(), filename), "utf8"),
    ) as StoryboardTask;
    if (task.status === "pending" || processingLeaseExpired(task)) {
      tasks.push(task);
    }
  }
  const task = tasks.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )[0];
  if (!task) {
    return null;
  }
  const timestamp = new Date().toISOString();
  task.status = "processing";
  task.claimedAt = timestamp;
  task.updatedAt = timestamp;
  task.error = undefined;
  await writeTask(task);
  return task;
}

export async function completeStoryboardTask(
  requestId: string,
  rawResult: unknown,
): Promise<StoryboardTask> {
  const task = await getStoryboardTask(requestId);
  if (!task) {
    throw new Error(`未找到分镜任务 ${requestId}`);
  }
  const result = MiraDirectorResponseSchema.parse(rawResult);
  if (result.request_id !== requestId) {
    throw new Error("提交结果的 request_id 与任务不一致");
  }
  if (result.status === "ready") {
    const expectedSlots = task.input.participants.map(
      (participant) => participant.slot,
    );
    const participantSlots = new Set(expectedSlots);
    const actualSlots = result.blocking.placements.map(
      (placement) => placement.subject,
    );
    const positions = result.blocking.placements.map(
      (placement) => placement.position,
    );
    if (
      actualSlots.length !== expectedSlots.length ||
      actualSlots.some((slot, index) => slot !== expectedSlots[index])
    ) {
      throw new Error(
        "blocking.placements 必须按原顺序覆盖所有角色槽位",
      );
    }
    if (new Set(positions).size !== positions.length) {
      throw new Error("blocking.placements 中的 position 不能重复");
    }
    const dialogueIndexById = new Map(
      task.input.dialogue.map((line, index) => [
        line.dialogue_id,
        index,
      ]),
    );
    const firstDialogueBySlot = new Map(
      task.input.participants.map((participant) => [
        participant.slot,
        participant.first_dialogue_id,
      ]),
    );
    const lastDialogueBySlot = new Map(
      task.input.participants.map((participant) => [
        participant.slot,
        participant.last_dialogue_id,
      ]),
    );
    const entryIndexBySlot = new Map<
      (typeof expectedSlots)[number],
      number
    >();
    const exitIndexBySlot = new Map<
      (typeof expectedSlots)[number],
      number | null
    >();
    const validatedShots: Array<{
      activeCount: number;
      isRelationshipWide: boolean;
    }> = [];
    for (const placement of result.blocking.placements) {
      if (
        placement.facing !== "group_center" &&
        !participantSlots.has(placement.facing)
      ) {
        throw new Error(
          `角色 ${placement.subject} 面向了不存在的角色 ${placement.facing}`,
        );
      }
      if (placement.facing === placement.subject) {
        throw new Error(`角色 ${placement.subject} 不能面向自己`);
      }
      const entryIndex = dialogueIndexById.get(
        placement.entry_dialogue_id,
      );
      const firstDialogueId = firstDialogueBySlot.get(
        placement.subject,
      );
      const firstDialogueIndex = firstDialogueId
        ? dialogueIndexById.get(firstDialogueId)
        : undefined;
      if (entryIndex === undefined || firstDialogueIndex === undefined) {
        throw new Error(
          `角色 ${placement.subject} 的登场节点不在当前对话中`,
        );
      }
      if (entryIndex > firstDialogueIndex) {
        throw new Error(
          `角色 ${placement.subject} 的登场不能晚于首次发言 ${firstDialogueId}`,
        );
      }
      const exitIndex =
        placement.exit_dialogue_id === null
          ? null
          : dialogueIndexById.get(placement.exit_dialogue_id);
      const lastDialogueId = lastDialogueBySlot.get(placement.subject);
      const lastDialogueIndex = lastDialogueId
        ? dialogueIndexById.get(lastDialogueId)
        : undefined;
      if (exitIndex === undefined || lastDialogueIndex === undefined) {
        throw new Error(
          `角色 ${placement.subject} 的离场节点不在当前对话中`,
        );
      }
      if (exitIndex !== null && exitIndex < entryIndex) {
        throw new Error(
          `角色 ${placement.subject} 的离场不能早于登场 ${placement.entry_dialogue_id}`,
        );
      }
      if (exitIndex !== null && exitIndex < lastDialogueIndex) {
        throw new Error(
          `角色 ${placement.subject} 的离场不能早于最后发言 ${lastDialogueId}`,
        );
      }
      entryIndexBySlot.set(placement.subject, entryIndex);
      exitIndexBySlot.set(placement.subject, exitIndex);
    }
    for (const [index, shot] of result.shots.entries()) {
      if (
        shot.subject !== "both" &&
        shot.subject !== "group" &&
        !participantSlots.has(shot.subject)
      ) {
        throw new Error(
          `镜头 ${index + 1} 使用了不在任务中的角色槽位 ${shot.subject}`,
        );
      }
      const shotDialogueIndexes = shot.dialogue_ids.map((dialogueId) => {
        const dialogueIndex = dialogueIndexById.get(dialogueId);
        if (dialogueIndex === undefined) {
          throw new Error(
            `镜头 ${index + 1} 使用了未知台词节点 ${dialogueId}`,
          );
        }
        return dialogueIndex;
      });
      const shotStartIndex = Math.min(...shotDialogueIndexes);
      const shotEndIndex = Math.max(...shotDialogueIndexes);
      const attendanceChange = expectedSlots.find((slot) => {
        const entryIndex =
          entryIndexBySlot.get(slot) ?? Number.POSITIVE_INFINITY;
        const exitIndex = exitIndexBySlot.get(slot);
        return (
          (entryIndex > shotStartIndex && entryIndex <= shotEndIndex) ||
          (exitIndex !== null &&
            exitIndex !== undefined &&
            exitIndex >= shotStartIndex &&
            exitIndex < shotEndIndex)
        );
      });
      if (attendanceChange) {
        throw new Error(
          `镜头 ${index + 1} 跨越了角色 ${attendanceChange} 的进出场节点`,
        );
      }
      const activeSlots = expectedSlots.filter((slot) => {
        const exitIndex = exitIndexBySlot.get(slot);
        return (
          (entryIndexBySlot.get(slot) ?? Number.POSITIVE_INFINITY) <=
            shotEndIndex &&
          (exitIndex === null ||
            (exitIndex !== undefined && exitIndex >= shotEndIndex))
        );
      });
      const activeCount = activeSlots.length;
      const isRelationshipWide =
        shot.template === "master_two_shot" ||
        shot.template === "master_group_shot";
      const hasEntranceAtStart =
        shotStartIndex > 0 &&
        expectedSlots.some(
          (slot) => entryIndexBySlot.get(slot) === shotStartIndex,
        );
      const hasExitBeforeStart =
        shotStartIndex > 0 &&
        expectedSlots.some(
          (slot) => exitIndexBySlot.get(slot) === shotStartIndex - 1,
        );
      if (
        activeCount >= 2 &&
        (hasEntranceAtStart || hasExitBeforeStart) &&
        !isRelationshipWide
      ) {
        throw new Error(
          `镜头 ${index + 1} 位于角色进出场边界，必须使用全景重新建立空间`,
        );
      }
      if (
        isRelationshipWide &&
        ![
          "establish_geography",
          "reestablish_geography",
          "relationship",
        ].includes(shot.coverage_intent)
      ) {
        throw new Error(
          `镜头 ${index + 1} 的全景模板与 coverage_intent 不匹配`,
        );
      }
      if (
        !isRelationshipWide &&
        ["establish_geography", "reestablish_geography"].includes(
          shot.coverage_intent,
        )
      ) {
        throw new Error(
          `镜头 ${index + 1} 声明建立空间，但没有使用双人或群像全景模板`,
        );
      }
      if (
        shot.subject !== "both" &&
        shot.subject !== "group" &&
        !activeSlots.includes(shot.subject)
      ) {
        throw new Error(
          `镜头 ${index + 1} 的主体 ${shot.subject} 尚未登场或已经离场`,
        );
      }
      const groupSubject =
        shot.subject === "both" || shot.subject === "group";
      if (groupSubject && shot.look_target !== "group_center") {
        throw new Error(
          `镜头 ${index + 1} 的群体镜头必须面向 group_center`,
        );
      }
      if (!groupSubject && shot.look_target === shot.subject) {
        throw new Error(
          `镜头 ${index + 1} 的主体 ${shot.subject} 不能看向自己`,
        );
      }
      if (
        !groupSubject &&
        activeCount > 1 &&
        (shot.look_target === "group_center" ||
          !activeSlots.includes(shot.look_target))
      ) {
        throw new Error(
          `镜头 ${index + 1} 的关系轴目标 ${shot.look_target} 无效`,
        );
      }
      if (
        (shot.subject === "both" ||
          shot.template === "master_two_shot" ||
          shot.template === "profile_two_shot") &&
        activeCount !== 2
      ) {
        throw new Error(
          `镜头 ${index + 1} 的双人主体或模板要求该节点恰有两位角色在场`,
        );
      }
      if (
        (shot.template === "master_two_shot" ||
          shot.template === "profile_two_shot") &&
        shot.subject !== "both"
      ) {
        throw new Error(
          `镜头 ${index + 1} 的双人模板必须使用 both 主体`,
        );
      }
      if (
        shot.subject === "group" &&
        (shot.template !== "master_group_shot" || activeCount < 3)
      ) {
        throw new Error(
          `镜头 ${index + 1} 的 group 主体要求至少三位角色在场并使用 master_group_shot`,
        );
      }
      if (
        shot.template === "master_group_shot" &&
        shot.subject !== "group"
      ) {
        throw new Error(
          `镜头 ${index + 1} 的 master_group_shot 必须使用 group 主体`,
        );
      }
      if (
        shot.template === "speaker_group_medium" &&
        (shot.subject === "both" ||
          shot.subject === "group" ||
          activeCount < 2)
      ) {
        throw new Error(
          `镜头 ${index + 1} 的带群中景要求至少两位角色在场并指定单个主体`,
        );
      }
      validatedShots.push({ activeCount, isRelationshipWide });
    }
    const expectedIds = task.input.dialogue.map((line) => line.dialogue_id);
    const actualIds = result.shots.flatMap((shot) => shot.dialogue_ids);
    if (
      actualIds.length !== expectedIds.length ||
      actualIds.some((dialogueId, index) => dialogueId !== expectedIds[index])
    ) {
      throw new Error(
        "shots 必须按原顺序覆盖所有 dialogue_id，且每个 ID 只能出现一次",
      );
    }
    const openingShots = validatedShots.slice(0, 3);
    if (
      openingShots.some((shot) => shot.activeCount >= 2) &&
      !openingShots.some((shot) => shot.isRelationshipWide)
    ) {
      throw new Error(
        "前三个镜头必须至少包含一个交代当前角色关系与站位的双人或群像全景",
      );
    }
  }
  task.result = result;
  task.status = "completed";
  task.updatedAt = new Date().toISOString();
  task.cacheKey = taskCacheKey(task);
  task.error = undefined;
  await writeTask(task);
  await completeMatchingActiveTasks(
    await readAllTasks(),
    task.cacheKey,
    task,
  );
  return task;
}

export async function failStoryboardTask(
  requestId: string,
  errorMessage: string,
): Promise<StoryboardTask> {
  const task = await getStoryboardTask(requestId);
  if (!task) {
    throw new Error(`未找到分镜任务 ${requestId}`);
  }
  task.status = "failed";
  task.error = errorMessage.slice(0, 1_000);
  task.updatedAt = new Date().toISOString();
  await writeTask(task);
  return task;
}

export async function storyboardTaskStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  await mkdir(taskDirectory(), { recursive: true });
  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const filename of await readdir(taskDirectory())) {
    if (!filename.endsWith(".json")) {
      continue;
    }
    const task = JSON.parse(
      await readFile(join(taskDirectory(), filename), "utf8"),
    ) as StoryboardTask;
    stats[task.status] += 1;
  }
  return stats;
}
