import { z } from "zod";
import type { DialogueSequence, ShotPlan } from "../types";
import {
  createDirectorInput, DirectorInputSchema, DirectorDecisionSchema,
  MiraReadyResponseSchema, ParticipantSlotSchema,
  COMPOSITION_MODES, VISUAL_ANCHORS, NEGATIVE_SPACE_MODES, COMPOSITION_TRANSITIONS,
  type DirectorBlocking, type DirectorSceneAnalysis, type ReadyDirectorResponse,
} from "./contracts";
import { resolveShotDecisions } from "./shotResolver";
import { sequenceFromDirectorInput } from "./orchestrator";

const VectorSchema = z.tuple([z.number(), z.number(), z.number()]);
const SnapshotSchema = z.object({
  id: z.string().min(1),
  decision: DirectorDecisionSchema,
  duration: z.number().positive(),
  cameraPosition: VectorSchema,
  cameraTarget: VectorSchema,
  cameraEndPosition: VectorSchema,
  cameraEndTarget: VectorSchema,
  compositionPlan: z.object({
    mode: z.enum(COMPOSITION_MODES), visualAnchor: z.enum(VISUAL_ANCHORS),
    negativeSpace: z.enum(NEGATIVE_SPACE_MODES), transition: z.enum(COMPOSITION_TRANSITIONS),
  }),
  facingOverrides: z.partialRecord(ParticipantSlotSchema, VectorSchema),
  feedback: z.object({
    geometry: z.array(z.string().max(1000)).max(24),
    visual: z.string().max(1000).optional(),
    model: z.string().max(160).optional(),
  }),
});

export const ShotRefinementRequestSchema = z.object({
  schema_version: z.literal("shot-refinement.v1"),
  input: DirectorInputSchema,
  baseline: z.object({
    scene_analysis: MiraReadyResponseSchema.shape.scene_analysis,
    blocking: MiraReadyResponseSchema.shape.blocking,
    shots: z.array(SnapshotSchema).min(1).max(500),
  }),
  target_indexes: z.array(z.number().int().nonnegative()).min(1).max(24),
  instruction: z.string().trim().min(2).max(1000),
}).strict().superRefine((request, context) => {
  const targets = request.target_indexes;
  const expected = request.input.dialogue.map((line) => line.dialogue_id);
  const actual = request.baseline.shots.flatMap((shot) => shot.decision.dialogue_ids);
  if (new Set(targets).size !== targets.length ||
      targets.some((index) => index >= request.baseline.shots.length)) {
    context.addIssue({ code: "custom", message: "精修镜头范围无效" });
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    context.addIssue({ code: "custom", message: "精修基线必须完整覆盖当前对白" });
  }
  if (request.input.participants.some((p) => !p.initial_position || !p.initial_facing_target)) {
    context.addIssue({ code: "custom", message: "精修基线缺少角色位置或朝向" });
  }
});

export const ShotRefinementPatchSchema = z.object({
  baseline_version: z.string().regex(/^[a-f0-9]{64}$/),
  replacements: z.array(z.object({
    shot_index: z.number().int().nonnegative(),
    decision: DirectorDecisionSchema,
  }).strict()).min(1).max(24),
}).strict();

export type ShotRefinementRequest = z.infer<typeof ShotRefinementRequestSchema>;
export type ShotRefinementPatch = z.infer<typeof ShotRefinementPatchSchema>;
export type VersionedRefinement = ShotRefinementRequest & { baseline_version: string };

export function createShotRefinementRequest(
  sequence: DialogueSequence, shots: ShotPlan[], targetIndexes: number[],
  instruction: string, blocking: DirectorBlocking, analysis?: DirectorSceneAnalysis,
): ShotRefinementRequest {
  return ShotRefinementRequestSchema.parse({
    schema_version: "shot-refinement.v1",
    input: createDirectorInput(sequence, `refine-${crypto.randomUUID()}`, {
      preserveInputFormation: true, lockPlayerPosition: true, collectRevisionCases: false,
    }),
    baseline: {
      scene_analysis: {
        dramatic_goal: analysis?.dramaticGoal || sequence.outline || "保留当前叙事目标",
        emotional_progression: analysis?.emotionalProgression || "沿用当前节奏",
        visual_strategy: analysis?.visualStrategy || "沿用当前方案",
      },
      blocking,
      shots: shots.map((shot) => ({
        id: shot.id, decision: shot.directorDecision, duration: shot.duration,
        cameraPosition: shot.cameraPosition, cameraTarget: shot.cameraTarget,
        cameraEndPosition: shot.cameraEndPosition, cameraEndTarget: shot.cameraEndTarget,
        compositionPlan: shot.compositionPlan,
        facingOverrides: shot.facingOverrides,
        feedback: {
          geometry: shot.projection.warnings.slice(0, 24).map((text) => text.slice(0, 1000)),
          visual: shot.advisorReview?.reason.slice(0, 1000),
          model: shot.advisorReview?.model.slice(0, 160),
        },
      })),
    },
    target_indexes: targetIndexes, instruction,
  });
}

export function refinementBaselinePlan(request: ShotRefinementRequest): ReadyDirectorResponse {
  return {
    schema_version: "shot-plan.v5", request_id: request.input.request_id, status: "ready",
    scene_analysis: request.baseline.scene_analysis, blocking: request.baseline.blocking,
    shots: request.baseline.shots.map((shot) => shot.decision), sound_effects: [],
  };
}

export function mergeRefinementPatch(request: VersionedRefinement, raw: unknown) {
  const patch = ShotRefinementPatchSchema.parse(raw);
  if (patch.baseline_version !== request.baseline_version) throw new Error("精修基线版本不一致");
  const indexes = patch.replacements.map((item) => item.shot_index);
  if (new Set(indexes).size !== indexes.length ||
      indexes.length !== request.target_indexes.length ||
      indexes.some((index) => !request.target_indexes.includes(index))) {
    throw new Error("只可替换本次选中的镜头，不能遗漏、重复或越界");
  }
  const plan = refinementBaselinePlan(request);
  for (const { shot_index, decision } of patch.replacements) {
    if (JSON.stringify(decision.dialogue_ids) !== JSON.stringify(plan.shots[shot_index].dialogue_ids)) {
      throw new Error("局部精修不能改变镜头的对白覆盖");
    }
    plan.shots[shot_index] = decision;
  }
  return plan;
}

/** Reconstruct actual baseline cameras, including VLM-selected alternatives. */
export function resolveRefinement(request: ShotRefinementRequest, plan: ReadyDirectorResponse) {
  const sequence = sequenceFromDirectorInput(request.input);
  sequence.participants = sequence.participants.map((participant, index) => {
    const input = request.input.participants[index];
    const entry = input.entry_dialogue_id ?? input.first_dialogue_id;
    const exit = input.exit_dialogue_id ?? null;
    return { ...participant, entryDialogueId: entry,
      entryIndex: request.input.dialogue.findIndex((line) => line.dialogue_id === entry),
      exitDialogueId: exit,
      exitIndex: exit === null ? null : request.input.dialogue.findIndex((line) => line.dialogue_id === exit) };
  });
  const facingOverrides = new Map(request.baseline.shots.map((shot, index) =>
    [index, { ...Object.fromEntries(sequence.participants.map((p) => [p.slot, p.facingTarget])), ...shot.facingOverrides }] as const));
  const resolve = (changed: boolean) => {
    const frozen = request.baseline.shots.flatMap((shot, index) =>
      changed && request.target_indexes.includes(index) ? [] : [{ shot, index }]);
    return resolveShotDecisions(sequence, changed ? plan.shots : refinementBaselinePlan(request).shots, {
      facingOverrides,
      cameraOverrides: new Map(frozen.map(({ shot, index }) => [index, {
        position: shot.cameraPosition, target: shot.cameraTarget,
        composition: shot.compositionPlan,
      }])),
      motionOverrides: new Map(frozen.map(({ shot, index }) => [index, {
        endPosition: shot.cameraEndPosition, endTarget: shot.cameraEndTarget,
      }])),
    });
  };
  const before = resolve(false);
  const after = resolve(true);
  const failures = after.flatMap((shot, index) => {
    const issues = (shot.projection.issues ?? []).filter((issue) =>
      issue.severity === "error" && (request.target_indexes.includes(index) ||
        !(before[index].projection.issues ?? []).some((old) => old.severity === "error" &&
          old.ruleId === issue.ruleId && old.message === issue.message)));
    return issues.length ? [{ shot_index: index, warnings: issues.map((issue) => issue.message) }] : [];
  });
  return { shots: after, failures };
}

export function applyRefinement(
  request: ShotRefinementRequest, baseline: ShotPlan[], plan: ReadyDirectorResponse,
): ShotPlan[] {
  const { shots, failures } = resolveRefinement(request, plan);
  if (failures.length) throw new Error("精修结果未通过投影或相邻镜头连续性检查");
  return baseline.map((shot, index) => request.target_indexes.includes(index) ? {
    ...shots[index], id: shot.id, duration: shot.duration,
    actorActions: shot.actorActions, facingOverrides: shot.facingOverrides,
  } : shot);
}

/** Only the local neighbourhood and relevant advice are sent to the model. */
export function refinementTaskPacket(request: VersionedRefinement) {
  const relevant = new Set(request.target_indexes.flatMap((index) => [index - 1, index, index + 1]));
  const shots = request.baseline.shots.flatMap((shot, index) => relevant.has(index)
    ? [{ shot_index: index, editable: request.target_indexes.includes(index), ...shot }] : []);
  const ids = new Set(shots.flatMap((shot) => shot.decision.dialogue_ids));
  return {
    task_type: "refine_shots", baseline_version: request.baseline_version,
    instruction: request.instruction, target_indexes: request.target_indexes,
    scene_analysis: request.baseline.scene_analysis,
    participants: request.input.participants,
    dialogue: request.input.dialogue.filter((line) => ids.has(line.dialogue_id)),
    shots, constraints: request.input.constraints,
    output: "调用 storyboard_submit_shot_patch，原样回传 baseline_version；replacements 使用零基 shot_index，仅覆盖全部 editable 镜头。保持对白覆盖、站位、朝向和动作；运镜需有叙事动机。验收失败按反馈修正原范围，不能提交整段方案。",
  };
}
