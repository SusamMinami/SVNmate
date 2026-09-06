import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  directorDialogueParticipants,
  type DirectorInput,
} from "../src/director/contracts";
import type {
  DirectorPreferenceFeedback,
  DirectorPreferenceReference,
} from "../src/director/preferenceContracts";
import {
  STORYBOARD_CACHE_POLICY,
  storyboardInputContentHash,
} from "./storyboardTaskStore";
import { storyboardRuntimeRoot } from "./storyboardRuntime";
import type { LarkCommandRunner } from "./storyboardCaseLibrary";

const BASE_TOKEN =
  process.env.STORYBOARD_SHARED_BASE_TOKEN ||
  "Ds5jbxDoxaUYDLsHBvLcFKvMnJc";
const TABLE_ID =
  process.env.DIRECTOR_PREFERENCE_TABLE_ID || "tbl2vbJGhKVK4W9t";
const SOFTWARE_VERSION = "v0.23.3+";
const MAX_REFERENCE_PREFERENCES = 6;
type CompactDirectorInput = Omit<DirectorInput, "sound_effect_catalog">;

interface PreferenceRecord {
  record_id?: string;
  偏好ID?: string | null;
  偏好指纹?: string | null;
  对话ID?: string | null;
  反馈类型?: string | string[] | null;
  反馈原因?: string | null;
  方案来源?: string | string[] | null;
  叙事功能?: string | null;
  原镜头JSON?: string | null;
  最终镜头JSON?: string | null;
  角色数?: number | null;
  站位来源?: string | string[] | null;
  整理状态?: string | string[] | null;
}

interface LarkCommandEnvelope {
  ok?: boolean;
  data?: unknown;
  error?: { message?: string };
}

const feedbackLabels = {
  accept: "采用",
  reject: "拒绝",
  manual_edit: "手动修改",
  plan_choice: "方案选择",
} as const;

const sourceLabels = {
  rule: "规则导演",
  trae: "TRAE 协作",
  mira: "Mira AI",
  shared: "共享方案",
} as const;

let preferenceCache:
  | { expiresAt: number; records: PreferenceRecord[] }
  | undefined;

function unwrapData<T>(envelope: LarkCommandEnvelope): T {
  if (envelope.ok === false || envelope.error) {
    throw new Error(envelope.error?.message || "飞书偏好库请求失败");
  }
  return (envelope.data ?? envelope) as T;
}

function selectedValue(value: string | string[] | null | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function compactText(value: string | null | undefined): string {
  return value?.trim() || "";
}

function completeInput(input: CompactDirectorInput): DirectorInput {
  return { ...input, sound_effect_catalog: [] };
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function preferenceShotSummary(value: unknown): string {
  const template = objectValue(value, "template");
  const label = objectValue(value, "label");
  const framing = objectValue(value, "framing");
  const subject =
    objectValue(value, "subject") ?? objectValue(value, "primarySubject");
  const lens =
    objectValue(value, "lens_mm") ?? objectValue(value, "lensMm");
  return [
    typeof template === "string" ? `模板 ${template}` : "",
    typeof label === "string" ? label : "",
    typeof framing === "string" ? `景别 ${framing}` : "",
    typeof subject === "string" ? `主体 ${subject}` : "",
    typeof lens === "number" ? `焦段 ${lens}mm` : "",
  ]
    .filter(Boolean)
    .join("；")
    .slice(0, 400);
}

function narrativeFunction(value: unknown): string {
  const intent =
    objectValue(value, "intent") ??
    objectValue(value, "coverage_intent") ??
    objectValue(value, "coverageIntent");
  return typeof intent === "string" ? intent.slice(0, 240) : "";
}

async function queryPreferenceRecords(
  runner: LarkCommandRunner,
  fields: string[],
  filter: Record<string, unknown>,
): Promise<PreferenceRecord[]> {
  const runtimeRoot = storyboardRuntimeRoot();
  const outputDirectory = join(runtimeRoot, ".preference-library");
  const filename = `query-${randomUUID()}.ndjson`;
  const relativeOutput = `.preference-library/${filename}`;
  const absoluteOutput = join(outputDirectory, filename);
  const manifestOutput = absoluteOutput.replace(/\.ndjson$/, ".manifest.json");
  await mkdir(outputDirectory, { recursive: true });
  try {
    const args = [
      "base",
      "+record-list",
      "--base-token",
      BASE_TOKEN,
      "--table-id",
      TABLE_ID,
      "--filter-json",
      JSON.stringify(filter),
    ];
    for (const field of fields) args.push("--field-id", field);
    args.push(
      "--format",
      "ndjson",
      "--output",
      relativeOutput,
      "--as",
      "user",
    );
    unwrapData(await runner(args, 30_000, runtimeRoot));
    const content = await readFile(absoluteOutput, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as PreferenceRecord];
        } catch {
          return [];
        }
      });
  } finally {
    await Promise.all([
      rm(absoluteOutput, { force: true }),
      rm(manifestOutput, { force: true }),
    ]);
  }
}

function sourceFromLabel(
  value: string,
): DirectorPreferenceFeedback["source"] {
  const entry = Object.entries(sourceLabels).find(
    ([, label]) => label === value,
  );
  return (entry?.[0] as DirectorPreferenceFeedback["source"]) ?? "rule";
}

function typeFromLabel(
  value: string,
): DirectorPreferenceFeedback["feedback_type"] {
  const entry = Object.entries(feedbackLabels).find(
    ([, label]) => label === value,
  );
  return (
    (entry?.[0] as DirectorPreferenceFeedback["feedback_type"]) ?? "accept"
  );
}

export async function findRelevantDirectorPreferences(
  input: CompactDirectorInput,
  runner: LarkCommandRunner,
): Promise<DirectorPreferenceReference[]> {
  if (process.env.DIRECTOR_PREFERENCE_LIBRARY_DISABLED === "1") return [];
  const now = Date.now();
  const records =
    preferenceCache && preferenceCache.expiresAt > now
      ? preferenceCache.records
      : await queryPreferenceRecords(
          runner,
          [
            "偏好ID",
            "对话ID",
            "反馈类型",
            "反馈原因",
            "方案来源",
            "叙事功能",
            "原镜头JSON",
            "最终镜头JSON",
            "角色数",
            "站位来源",
            "整理状态",
          ],
          {
            logic: "and",
            conditions: [["整理状态", "intersects", ["已确认"]]],
          },
        ).then((nextRecords) => {
          preferenceCache = {
            expiresAt: now + 30_000,
            records: nextRecords,
          };
          return nextRecords;
        });
  const roleCount = directorDialogueParticipants(completeInput(input)).length;
  const positionSource = input.constraints.preserve_input_formation
    ? "BP"
    : "自动";
  return records
    .map((record) => {
      const selectedShotJson =
        compactText(record.最终镜头JSON) || compactText(record.原镜头JSON);
      let selectedShot: unknown = {};
      try {
        selectedShot = JSON.parse(selectedShotJson);
      } catch {
        // Keep malformed historical records out of the prompt.
      }
      const score =
        (record.对话ID === input.dialogue_prefix ? 8 : 0) +
        (record.角色数 === roleCount ? 3 : 0) +
        (selectedValue(record.站位来源) === positionSource ? 2 : 0);
      const preferenceId = compactText(record.偏好ID);
      return {
        score,
        reference: preferenceId
          ? {
              preferenceId,
              feedbackType: typeFromLabel(
                selectedValue(record.反馈类型),
              ),
              reason: compactText(record.反馈原因),
              source: sourceFromLabel(selectedValue(record.方案来源)),
              narrativeFunction: compactText(record.叙事功能),
              roleCount: record.角色数 ?? 0,
              positionSource: selectedValue(record.站位来源) === "BP"
                ? ("BP" as const)
                : ("自动" as const),
              shotSummary: preferenceShotSummary(selectedShot),
            }
          : null,
      };
    })
    .filter(
      (
        item,
      ): item is { score: number; reference: DirectorPreferenceReference } =>
        item.score > 0 && Boolean(item.reference),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.reference.preferenceId.localeCompare(
          right.reference.preferenceId,
        ),
    )
    .slice(0, MAX_REFERENCE_PREFERENCES)
    .map((item) => item.reference);
}

export function directorPreferenceFingerprint(
  feedback: DirectorPreferenceFeedback,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        content: storyboardInputContentHash(completeInput(feedback.input)),
        shotIndex: feedback.shot_index,
        source: feedback.source,
        originalShot: feedback.original_shot,
      }),
    )
    .digest("hex");
}

export async function saveDirectorPreference(
  feedback: DirectorPreferenceFeedback,
  runner: LarkCommandRunner,
): Promise<{ recordId: string; updated: boolean }> {
  if (process.env.DIRECTOR_PREFERENCE_LIBRARY_DISABLED === "1") {
    throw new Error("导演偏好库已禁用");
  }
  const fingerprint = directorPreferenceFingerprint(feedback);
  const preferenceId = `PREF-${fingerprint.slice(0, 12).toUpperCase()}`;
  const existing = await queryPreferenceRecords(
    runner,
    ["偏好指纹"],
    {
      logic: "and",
      conditions: [["偏好指纹", "==", fingerprint]],
    },
  );
  const finalShot =
    feedback.feedback_type === "reject"
      ? undefined
      : feedback.final_shot ?? feedback.original_shot;
  const originalJson = JSON.stringify(feedback.original_shot);
  const finalJson = finalShot === undefined ? "" : JSON.stringify(finalShot);
  const fields: Record<string, string | number | string[]> = {
    偏好名称: `${feedback.input.dialogue_prefix} · 镜头 ${feedback.shot_index + 1} · ${feedbackLabels[feedback.feedback_type]}`,
    偏好ID: preferenceId,
    偏好指纹: fingerprint,
    对话ID: feedback.input.dialogue_prefix,
    任务ID: feedback.input.request_id,
    镜头序号: feedback.shot_index + 1,
    台词节点: Array.isArray(objectValue(feedback.original_shot, "dialogueIds"))
      ? (objectValue(feedback.original_shot, "dialogueIds") as string[]).join(
          ", ",
        )
      : "",
    反馈类型: [feedbackLabels[feedback.feedback_type]],
    反馈原因: feedback.reason,
    方案来源: [sourceLabels[feedback.source]],
    叙事功能: narrativeFunction(
      finalShot ?? feedback.original_shot,
    ),
    原镜头JSON: originalJson,
    最终镜头JSON: finalJson,
    修改字段:
      feedback.feedback_type === "manual_edit"
        ? "由镜头沙盘人工调整"
        : "",
    场景梗概: feedback.input.outline,
    角色数: directorDialogueParticipants(
      completeInput(feedback.input),
    ).length,
    站位来源: [
      feedback.input.constraints.preserve_input_formation ? "BP" : "自动",
    ],
    模型名称: "qwen3-vl:4b",
    参考返修案例IDs: "",
    内容指纹: storyboardInputContentHash(completeInput(feedback.input)),
    整理状态: ["已确认"],
    规则集版本: STORYBOARD_CACHE_POLICY,
    软件版本: SOFTWARE_VERSION,
    记录时间: new Date().toISOString(),
  };
  const recordId = existing[0]?.record_id;
  if (recordId) {
    unwrapData(
      await runner([
        "base",
        "+record-batch-update",
        "--base-token",
        BASE_TOKEN,
        "--table-id",
        TABLE_ID,
        "--json",
        JSON.stringify({ update_records: { [recordId]: fields } }),
        "--as",
        "user",
      ]),
    );
    preferenceCache = undefined;
    return { recordId, updated: true };
  }
  const data = unwrapData<{ record_id_list?: string[] }>(
    await runner([
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
  if (!createdRecordId) throw new Error("飞书偏好库未返回新记录 ID");
  preferenceCache = undefined;
  return { recordId: createdRecordId, updated: false };
}
