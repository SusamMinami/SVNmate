import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  directorDialogueParticipants,
  type DirectorDecision,
  type DirectorInput,
  type DirectorRevisionReflection,
  type ReadyDirectorResponse,
} from "../src/director/contracts";
import type { DirectorProjectionFailure } from "../src/director/orchestrator";
import {
  STORYBOARD_CACHE_POLICY,
  storyboardInputContentHash,
} from "./storyboardTaskStore";
import { storyboardRuntimeRoot } from "./storyboardRuntime";

const BASE_TOKEN =
  process.env.STORYBOARD_SHARED_BASE_TOKEN ||
  "Ds5jbxDoxaUYDLsHBvLcFKvMnJc";
const TABLE_ID =
  process.env.STORYBOARD_CASE_TABLE_ID || "tblaVfeKhPW7rtcE";
const SOFTWARE_VERSION = "v0.17.2+";
const MAX_REFERENCE_CASES = 5;

interface LarkCommandEnvelope {
  ok?: boolean;
  data?: unknown;
  error?: {
    type?: string;
    subtype?: string;
    message?: string;
  };
}

export type LarkCommandRunner = (
  args: string[],
  timeout?: number,
  cwd?: string,
) => Promise<LarkCommandEnvelope>;

export interface StoryboardRevisionReference {
  caseId: string;
  failureSignature: string;
  originalTemplate: string;
  revisedTemplate: string;
  summary: string;
  strategy: string;
  appliesWhen: string;
  avoidWhen: string;
}

export type StoryboardRevisionSource = "Mira AI" | "TRAE 协作";

interface CaseRecord {
  record_id?: string;
  案例ID?: string | null;
  案例指纹?: string | null;
  失败签名?: string | null;
  验收原因?: string | null;
  原模板?: string | null;
  新模板?: string | null;
  修改摘要?: string | null;
  修改策略?: string | null;
  适用条件?: string | null;
  不适用条件?: string | null;
  返修结果?: string | string[] | null;
  审核状态?: string | string[] | null;
  站位来源?: string | string[] | null;
  角色数?: number | null;
}

export interface RevisionCaseDraft {
  caseId: string;
  fingerprint: string;
  shotIndex: number;
  dialogueIds: string[];
  failureSignature: string;
  warnings: string[];
  before: DirectorDecision;
  after: DirectorDecision;
  beforeErrorCount: number;
  afterErrorCount: number;
  outcome: "通过" | "改善" | "无改善" | "恶化";
  reflection: DirectorRevisionReflection;
}

function unwrapData<T>(envelope: LarkCommandEnvelope): T {
  if (envelope.ok === false || envelope.error) {
    throw new Error(envelope.error?.message || "飞书案例库请求失败");
  }
  return (envelope.data ?? envelope) as T;
}

function selectedValue(value: string | string[] | null | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function normalizedText(value: string | null | undefined): string {
  return value?.trim() || "";
}

export function caseLibraryEnabled(): boolean {
  return process.env.STORYBOARD_CASE_LIBRARY_DISABLED !== "1";
}

export function failureTags(warnings: readonly string[]): string[] {
  const tags = new Set<string>();
  for (const warning of warnings) {
    const checks: Array<[RegExp, string]> = [
      [/视线空间|look room|脸后空间|短边/i, "look_room"],
      [/头部空间|头顶|headroom/i, "headroom"],
      [/21:9|安全框|裁切|画框/i, "safe_frame"],
      [/重叠|遮挡|轮廓/i, "overlap"],
      [/入画|人数|单人|双人|群像|覆盖/i, "coverage"],
      [/轴线|越轴|同侧/i, "axis"],
      [/30\s*度|跳切|角度变化/i, "angle_change"],
      [/眼迹|视觉落点|锚点/i, "eye_trace"],
      [/构图|视觉重量|对称/i, "composition"],
      [/运动|起点|终点|推近|拉远|焦距/i, "movement"],
    ];
    for (const [pattern, tag] of checks) {
      if (pattern.test(warning)) {
        tags.add(tag);
      }
    }
  }
  if (tags.size === 0) {
    tags.add("projection");
  }
  return [...tags].sort();
}

export function failureSignature(warnings: readonly string[]): string {
  return failureTags(warnings).join("+");
}

function changedDecisionFields(
  before: DirectorDecision,
  after: DirectorDecision,
): string[] {
  return Object.keys(before).filter((key) => {
    const field = key as keyof DirectorDecision;
    return JSON.stringify(before[field]) !== JSON.stringify(after[field]);
  });
}

function fallbackReflection(
  failure: DirectorProjectionFailure,
  before: DirectorDecision,
  after: DirectorDecision,
): DirectorRevisionReflection {
  const changedFields = changedDecisionFields(before, after);
  const signature = failureSignature(failure.warnings);
  return {
    shot_index: failure.shotIndex,
    summary:
      changedFields.length > 0
        ? `针对 ${signature} 调整 ${changedFields.join("、")}`
        : `针对 ${signature} 重新评估镜头参数`,
    root_cause: failure.warnings.join("；").slice(0, 500),
    strategy:
      before.template === after.template
        ? `保留 ${before.template}，定向调整实际构图参数`
        : `将 ${before.template} 改为 ${after.template} 并重新验收`,
    applies_when: `出现 ${signature} 且人物站位与覆盖意图相近时`,
    avoid_when: "人物站位、叙事目标或在场人数明显不同时",
  };
}

function reflectionForShot(
  plan: ReadyDirectorResponse,
  failure: DirectorProjectionFailure,
  before: DirectorDecision,
  after: DirectorDecision,
): DirectorRevisionReflection {
  return (
    plan.revision_reflections?.find(
      (reflection) => reflection.shot_index === failure.shotIndex,
    ) ?? fallbackReflection(failure, before, after)
  );
}

export function buildRevisionCaseDrafts(
  input: DirectorInput,
  basePlan: ReadyDirectorResponse,
  revisedPlan: ReadyDirectorResponse,
  originalFailures: DirectorProjectionFailure[],
  revisedFailures: DirectorProjectionFailure[],
): RevisionCaseDraft[] {
  const revisedFailureByShot = new Map(
    revisedFailures.map((failure) => [failure.shotIndex, failure]),
  );
  const contentHash = storyboardInputContentHash(input);
  return originalFailures.flatMap((failure) => {
    const shotOffset = failure.shotIndex - 1;
    const before = basePlan.shots[shotOffset];
    const after = revisedPlan.shots[shotOffset];
    if (!before || !after) {
      return [];
    }
    const revisedFailure = revisedFailureByShot.get(failure.shotIndex);
    const beforeErrorCount = failure.warnings.length;
    const afterErrorCount = revisedFailure?.warnings.length ?? 0;
    const outcome =
      afterErrorCount === 0
        ? "通过"
        : afterErrorCount < beforeErrorCount
          ? "改善"
          : afterErrorCount === beforeErrorCount
            ? "无改善"
            : "恶化";
    const signature = failureSignature(failure.warnings);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          contentHash,
          shotIndex: failure.shotIndex,
          signature,
          before,
          after,
        }),
      )
      .digest("hex");
    return [
      {
        caseId: `CASE-${fingerprint.slice(0, 12).toUpperCase()}`,
        fingerprint,
        shotIndex: failure.shotIndex,
        dialogueIds: failure.dialogueIds,
        failureSignature: signature,
        warnings: failure.warnings,
        before,
        after,
        beforeErrorCount,
        afterErrorCount,
        outcome,
        reflection: reflectionForShot(
          revisedPlan,
          failure,
          before,
          after,
        ),
      },
    ];
  });
}

function referenceFromRecord(
  record: CaseRecord,
): StoryboardRevisionReference | null {
  const caseId = normalizedText(record.案例ID);
  const strategy = normalizedText(record.修改策略);
  if (
    !caseId ||
    !strategy ||
    selectedValue(record.审核状态) !== "已通过" ||
    !["通过", "改善"].includes(selectedValue(record.返修结果))
  ) {
    return null;
  }
  return {
    caseId,
    failureSignature: normalizedText(record.失败签名),
    originalTemplate: normalizedText(record.原模板),
    revisedTemplate: normalizedText(record.新模板),
    summary: normalizedText(record.修改摘要),
    strategy,
    appliesWhen: normalizedText(record.适用条件),
    avoidWhen: normalizedText(record.不适用条件),
  };
}

function scoreRecord(
  record: CaseRecord,
  input: DirectorInput,
  failures: DirectorProjectionFailure[],
): number {
  const signatures = new Set(
    failures.map((failure) => failureSignature(failure.warnings)),
  );
  const templates = new Set(
    failures.map((failure) => failure.decision.template),
  );
  let score = 0;
  if (signatures.has(normalizedText(record.失败签名))) {
    score += 8;
  }
  if (templates.has(normalizedText(record.原模板) as DirectorDecision["template"])) {
    score += 4;
  }
  const expectedPositionSource = input.constraints.preserve_input_formation
    ? "BP"
    : "自动";
  if (selectedValue(record.站位来源) === expectedPositionSource) {
    score += 2;
  }
  if (record.角色数 === directorDialogueParticipants(input).length) {
    score += 2;
  }
  return score;
}

async function queryCaseRecords(
  runner: LarkCommandRunner,
  fields: string[],
  filter: Record<string, unknown>,
): Promise<CaseRecord[]> {
  const runtimeRoot = storyboardRuntimeRoot();
  const outputDirectory = join(runtimeRoot, ".case-library");
  const filename = `query-${randomUUID()}.ndjson`;
  const relativeOutput = `.case-library/${filename}`;
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
    for (const field of fields) {
      args.push("--field-id", field);
    }
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
          return [JSON.parse(line) as CaseRecord];
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

export async function findRelevantStoryboardCases(
  input: DirectorInput,
  failures: DirectorProjectionFailure[],
  runner: LarkCommandRunner,
): Promise<StoryboardRevisionReference[]> {
  if (
    !caseLibraryEnabled() ||
    input.constraints.collect_revision_cases === false ||
    failures.length === 0
  ) {
    return [];
  }
  const records = await queryCaseRecords(
    runner,
    [
      "案例ID",
      "失败签名",
      "原模板",
      "新模板",
      "修改摘要",
      "修改策略",
      "适用条件",
      "不适用条件",
      "返修结果",
      "审核状态",
      "站位来源",
      "角色数",
    ],
    {
      logic: "and",
      conditions: [
        ["审核状态", "intersects", ["已通过"]],
        ["返修结果", "intersects", ["通过", "改善"]],
      ],
    },
  );
  return records
    .map((record) => ({
      record,
      reference: referenceFromRecord(record),
      score: scoreRecord(record, input, failures),
    }))
    .filter(
      (
        item,
      ): item is {
        record: CaseRecord;
        reference: StoryboardRevisionReference;
        score: number;
      } => Boolean(item.reference) && item.score > 0,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.reference.caseId.localeCompare(right.reference.caseId),
    )
    .slice(0, MAX_REFERENCE_CASES)
    .map((item) => item.reference);
}

function caseFields(
  input: DirectorInput,
  draft: RevisionCaseDraft,
  source: StoryboardRevisionSource,
  references: StoryboardRevisionReference[],
): Record<string, string | number | string[]> {
  return {
    案例名称: `${input.dialogue_prefix} · 镜头 ${draft.shotIndex} · ${draft.failureSignature}`,
    案例ID: draft.caseId,
    案例指纹: draft.fingerprint,
    任务ID: input.request_id,
    对话ID: input.dialogue_prefix,
    镜头序号: draft.shotIndex,
    台词节点: draft.dialogueIds.join(", "),
    失败签名: draft.failureSignature,
    验收原因: draft.warnings.join("；"),
    原模板: draft.before.template,
    新模板: draft.after.template,
    修改摘要: draft.reflection.summary,
    根因: draft.reflection.root_cause,
    修改策略: draft.reflection.strategy,
    适用条件: draft.reflection.applies_when,
    不适用条件: draft.reflection.avoid_when,
    返修前JSON: JSON.stringify(draft.before),
    返修后JSON: JSON.stringify(draft.after),
    返修前错误数: draft.beforeErrorCount,
    返修后错误数: draft.afterErrorCount,
    返修结果: [draft.outcome],
    审核状态: ["待审核"],
    站位来源: [
      input.constraints.preserve_input_formation ? "BP" : "自动",
    ],
    角色数: directorDialogueParticipants(input).length,
    规则集版本: STORYBOARD_CACHE_POLICY,
    软件版本: SOFTWARE_VERSION,
    来源: [source],
    参考案例IDs: references.map((reference) => reference.caseId).join(", "),
    内容指纹: storyboardInputContentHash(input),
  };
}

export async function saveStoryboardRevisionCases(
  input: DirectorInput,
  basePlan: ReadyDirectorResponse,
  revisedPlan: ReadyDirectorResponse,
  originalFailures: DirectorProjectionFailure[],
  revisedFailures: DirectorProjectionFailure[],
  source: StoryboardRevisionSource,
  references: StoryboardRevisionReference[],
  runner: LarkCommandRunner,
): Promise<{ created: number; skipped: number }> {
  if (
    !caseLibraryEnabled() ||
    input.constraints.collect_revision_cases === false
  ) {
    return { created: 0, skipped: 0 };
  }
  const drafts = buildRevisionCaseDrafts(
    input,
    basePlan,
    revisedPlan,
    originalFailures,
    revisedFailures,
  );
  if (drafts.length === 0) {
    return { created: 0, skipped: 0 };
  }
  const existing = await queryCaseRecords(
    runner,
    ["案例指纹"],
    {
      logic: "and",
      conditions: [["对话ID", "==", input.dialogue_prefix]],
    },
  );
  const fingerprints = new Set(
    existing.map((record) => normalizedText(record.案例指纹)).filter(Boolean),
  );
  const pending = drafts.filter(
    (draft) => !fingerprints.has(draft.fingerprint),
  );
  if (pending.length === 0) {
    return { created: 0, skipped: drafts.length };
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
      JSON.stringify({
        create_records: pending.map((draft) =>
          caseFields(input, draft, source, references),
        ),
      }),
      "--as",
      "user",
    ]),
  );
  const created = data.record_id_list?.length ?? 0;
  if (created !== pending.length) {
    throw new Error(
      `飞书案例库只返回 ${created}/${pending.length} 条记录 ID`,
    );
  }
  return { created, skipped: drafts.length - pending.length };
}
