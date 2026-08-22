import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DirectorInputSchema,
  MiraReadyResponseSchema,
  type DirectorInput,
  type MiraDirectorResponse,
} from "../src/director/contracts";
import { estimateDialogueDuration } from "../src/director/shotTiming";
import { runLark, unwrapData } from "./larkBridge";
import {
  STORYBOARD_CACHE_POLICY,
  storyboardInputContentHash,
} from "./storyboardTaskStore";
import { storyboardRuntimeRoot } from "./storyboardRuntime";

const BASE_TOKEN =
  process.env.STORYBOARD_SHARED_BASE_TOKEN ||
  "Ds5jbxDoxaUYDLsHBvLcFKvMnJc";
const TABLE_ID =
  process.env.STORYBOARD_SHARED_TABLE_ID || "tbleAtHPwkEoRwh7";

export function sharedLibraryEnabled(): boolean {
  return process.env.STORYBOARD_SHARED_LIBRARY_DISABLED !== "1";
}

export interface SharedStoryboardRecord {
  recordId: string;
  dialogueId: string;
  contentHash: string;
  policyVersion: string;
  taskId: string;
  updatedAt: string;
  input: DirectorInput;
  plan: Extract<MiraDirectorResponse, { status: "ready" }>;
}

interface BaseRecord {
  record_id: string;
  对话ID?: string | null;
  内容指纹?: string | null;
  策略版本?: string | null;
  任务ID?: string | null;
  更新时间?: string | null;
  输入JSON?: string | null;
  分镜JSON?: string | null;
}

function compactPlan(
  plan: Extract<MiraDirectorResponse, { status: "ready" }>,
  requestId: string,
): Extract<MiraDirectorResponse, { status: "ready" }> {
  return { ...plan, request_id: requestId };
}

function comparablePlan(
  plan: Extract<MiraDirectorResponse, { status: "ready" }>,
): string {
  return JSON.stringify({ ...plan, request_id: "" });
}

export function sharedPlansEqual(
  left: Extract<MiraDirectorResponse, { status: "ready" }>,
  right: Extract<MiraDirectorResponse, { status: "ready" }>,
): boolean {
  return comparablePlan(left) === comparablePlan(right);
}

function parseRecord(record: BaseRecord): SharedStoryboardRecord | null {
  if (
    !record.record_id ||
    !record.输入JSON ||
    !record.分镜JSON ||
    !record.对话ID
  ) {
    return null;
  }
  const input = DirectorInputSchema.safeParse(JSON.parse(record.输入JSON));
  const plan = MiraReadyResponseSchema.safeParse(JSON.parse(record.分镜JSON));
  if (!input.success || !plan.success) {
    return null;
  }
  return {
    recordId: record.record_id,
    dialogueId: record.对话ID,
    contentHash: record.内容指纹 || "",
    policyVersion: record.策略版本 || "",
    taskId: record.任务ID || plan.data.request_id,
    updatedAt: record.更新时间 || "",
    input: input.data as DirectorInput,
    plan: plan.data,
  };
}

export async function findSharedStoryboardRecords(
  input: DirectorInput,
): Promise<SharedStoryboardRecord[]> {
  if (!sharedLibraryEnabled()) {
    return [];
  }
  const runtimeRoot = storyboardRuntimeRoot();
  const outputDirectory = join(runtimeRoot, ".shared-library");
  const filename = `query-${randomUUID()}.ndjson`;
  const relativeOutput = `.shared-library/${filename}`;
  const absoluteOutput = join(outputDirectory, filename);
  const manifestOutput = absoluteOutput.replace(/\.ndjson$/, ".manifest.json");
  await mkdir(outputDirectory, { recursive: true });
  try {
    unwrapData(
      await runLark(
        [
          "base",
          "+record-list",
          "--base-token",
          BASE_TOKEN,
          "--table-id",
          TABLE_ID,
          "--filter-json",
          JSON.stringify({
            logic: "and",
            conditions: [["对话ID", "==", input.dialogue_prefix]],
          }),
          "--field-id",
          "对话ID",
          "--field-id",
          "内容指纹",
          "--field-id",
          "策略版本",
          "--field-id",
          "任务ID",
          "--field-id",
          "更新时间",
          "--field-id",
          "输入JSON",
          "--field-id",
          "分镜JSON",
          "--format",
          "ndjson",
          "--output",
          relativeOutput,
          "--as",
          "user",
        ],
        30_000,
        runtimeRoot,
      ),
    );
    const content = await readFile(absoluteOutput, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = parseRecord(JSON.parse(line) as BaseRecord);
          return parsed ? [parsed] : [];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    await Promise.all([
      rm(absoluteOutput, { force: true }),
      rm(manifestOutput, { force: true }),
    ]);
  }
}

export function findExactSharedStoryboard(
  input: DirectorInput,
  records: SharedStoryboardRecord[],
): SharedStoryboardRecord | null {
  const contentHash = storyboardInputContentHash(input);
  return (
    records.find(
      (record) =>
        record.contentHash === contentHash &&
        record.policyVersion === STORYBOARD_CACHE_POLICY,
    ) ?? null
  );
}

function sharedRecordFields(
  input: DirectorInput,
  plan: Extract<MiraDirectorResponse, { status: "ready" }>,
): Record<string, string | number> {
  const contentById = new Map(
    input.dialogue.map((line) => [line.dialogue_id, line.content]),
  );
  const durations = plan.shots.map((shot) =>
    shot.dialogue_ids.reduce(
      (total, dialogueId) =>
        total + estimateDialogueDuration(contentById.get(dialogueId) || ""),
      0,
    ),
  );
  const averageDuration =
    durations.reduce((total, duration) => total + duration, 0) /
    durations.length;
  const singleLineShots = plan.shots.filter(
    (shot) => shot.dialogue_ids.length === 1,
  ).length;
  return {
    方案名称: `${input.dialogue_prefix} · ${input.outline.slice(0, 28)}`,
    对话ID: input.dialogue_prefix,
    内容指纹: storyboardInputContentHash(input),
    策略版本: STORYBOARD_CACHE_POLICY,
    任务ID: input.request_id,
    镜头数: plan.shots.length,
    台词数: input.dialogue.length,
    角色数: input.participants.length,
    平均镜头时长: Number(averageDuration.toFixed(1)),
    平均每镜台词数: Number(
      (input.dialogue.length / plan.shots.length).toFixed(1),
    ),
    单句镜头数: singleLineShots,
    "单句镜头占比%": Number(
      ((singleLineShots / plan.shots.length) * 100).toFixed(1),
    ),
    剧情梗概: input.outline,
    戏剧目标: plan.scene_analysis.dramatic_goal,
    情绪推进: plan.scene_analysis.emotional_progression,
    视觉策略: plan.scene_analysis.visual_strategy,
    分镜JSON: JSON.stringify(compactPlan(plan, input.request_id)),
    输入JSON: JSON.stringify(input),
    来源: "镜头沙盘自动同步",
    更新时间: new Date().toISOString(),
    软件版本: "v0.11.0+",
  };
}

export async function saveSharedStoryboard(
  input: DirectorInput,
  rawPlan: unknown,
  recordId?: string,
): Promise<{ recordId: string; updated: boolean }> {
  if (!sharedLibraryEnabled()) {
    throw new Error("飞书共享库已禁用");
  }
  const plan = MiraReadyResponseSchema.parse(rawPlan);
  const normalizedPlan = compactPlan(plan, input.request_id);
  const fields = sharedRecordFields(input, normalizedPlan);
  if (recordId) {
    unwrapData(
      await runLark([
        "base",
        "+record-batch-update",
        "--base-token",
        BASE_TOKEN,
        "--table-id",
        TABLE_ID,
        "--json",
        JSON.stringify({
          update_records: { [recordId]: fields },
        }),
        "--as",
        "user",
      ]),
    );
    return { recordId, updated: true };
  }
  const data = unwrapData<{ record_id_list?: string[] }>(
    await runLark([
      "base",
      "+record-batch-create",
      "--base-token",
      BASE_TOKEN,
      "--table-id",
      TABLE_ID,
      "--json",
      JSON.stringify({ create_records: [fields] }),
      "--as",
      "user",
    ]),
  );
  const createdRecordId = data.record_id_list?.[0];
  if (!createdRecordId) {
    throw new Error("飞书共享库未返回新记录 ID");
  }
  return { recordId: createdRecordId, updated: false };
}
