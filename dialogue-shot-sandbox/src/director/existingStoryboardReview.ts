import type { DialogueSequence, ShotPlan, ShotValidationIssue } from "../types";
import { assessProjection, subjectAzimuthDelta } from "./shotGeometry";
import type { RuleCameraCandidateSet } from "./shotCandidateGenerator";
import { createDirectorInput } from "./contracts";
import {
  ExistingStoryboardReviewRequestSchema,
  RuleAdvisorResponseSchema,
  type RuleVisualScoreSchema,
} from "./ruleAdvisorContracts";
import type { z } from "zod";
import { readAdvisorProgress } from "./ruleAdvisor";

export interface ExistingShotReview {
  shotId: string;
  dialogueIds: string[];
  issues: ShotValidationIssue[];
  visual?: z.infer<typeof RuleVisualScoreSchema>;
}

export interface ExistingStoryboardReview {
  shots: ExistingShotReview[];
  model?: string;
  averageScore?: number;
  message: string;
}

// Imported assets do not carry these intentions. Never judge them against
// the generated baseline's desired framing/composition.
const INTENT_RULES = new Set([
  "FRM-001", "FRM-002", "GRP-002", "FRM-ANCHOR", "FRM-018",
  "FRM-019", "FRM-020", "FRM-SYMMETRY", "GRP-003", "FRM-DEPTH",
]);

export function inspectExistingStoryboard(sequence: DialogueSequence, shots: ShotPlan[]) {
  const reviews: ExistingShotReview[] = [];
  const previewShots: ShotPlan[] = [];
  for (const [index, shot] of shots.entries()) {
    const startIndex = sequence.rows.findIndex((row) => row.id === shot.dialogueId);
    const participants = sequence.participants.filter((participant) =>
      participant.entryIndex <= startIndex &&
      (participant.exitIndex === null || participant.exitIndex >= startIndex));
    const subject = participants.find((participant) => participant.slot === shot.speakerSlot)
      ?? participants[0];
    if (!subject) {
      reviews.push({ shotId: shot.id, dialogueIds: shot.dialogueIds, issues: [{
        ruleId: "REVIEW-CAST", severity: "warning", message: "缺少当前角色站位，无法检查画面。",
      }] });
      previewShots.push({ ...shot, facingOverrides: {} });
      continue;
    }
    const composition = { mode: "center", visualAnchor: "center", negativeSpace: "balanced", transition: "recenter" } as const;
    const geometry = { position: shot.cameraPosition, target: shot.cameraTarget };
    const measured = assessProjection(geometry, subject, participants, shot.focalLength,
      shot.projection.measuredShotSize, "single", composition, undefined, shot.cameraRollDegrees);
    const coverage = measured.visibleParticipantSlots.length > 1 ? "group-medium" : "single";
    const assessment = assessProjection(geometry, subject, participants, shot.focalLength,
      measured.measuredShotSize, coverage, composition, undefined, shot.cameraRollDegrees);
    const issues = assessment.issues.filter((issue) => !INTENT_RULES.has(issue.ruleId)).map((issue) => ({
      ...issue,
      // Speaker is a reference, not an imported visual-subject declaration.
      severity: issue.ruleId === "FRM-SUBJECT" || issue.ruleId === "FRM-004"
        ? "warning" as const : issue.severity,
      message: issue.ruleId === "FRM-SUBJECT" || issue.ruleId === "FRM-004"
        ? `${issue.message}；以发言角色为参考，请结合反应镜头意图复核` : issue.message,
    }));
    const previous = previewShots[index - 1];
    if (previous && previous.speakerSlot === shot.speakerSlot) {
      const delta = subjectAzimuthDelta(
        { position: previous.cameraEndPosition, target: previous.cameraEndTarget }, geometry, subject);
      const sizes = ["full", "medium-full", "medium", "medium-close-up", "close-up", "extreme-close-up"];
      const sameCamera = previous.cameraEndPosition.every((value, axis) => Math.abs(value - shot.cameraPosition[axis]) < 0.001)
        && previous.cameraEndTarget.every((value, axis) => Math.abs(value - shot.cameraTarget[axis]) < 0.001)
        && previous.endFocalLength === shot.focalLength;
      if (!sameCamera && delta < 30 && Math.abs(sizes.indexOf(previous.projection.measuredShotSize) - sizes.indexOf(measured.measuredShotSize)) < 2) {
        issues.push({ ruleId: "CON-003", severity: "warning", message: `同发言角色的相邻镜头视角仅变化 ${delta.toFixed(1)}°，景别变化较小，建议复核跳切。` });
      }
    }
    // With exactly two actors the relationship axis is unambiguous. Do not
    // borrow the generated plan's relationship axis for an imported group shot.
    if (participants.length === 2) {
      const [a, b] = participants;
      const side = (position: ShotPlan["cameraPosition"]) =>
        Math.sign((b.position[0] - a.position[0]) * (position[2] - a.position[2])
          - (b.position[2] - a.position[2]) * (position[0] - a.position[0]));
      const currentSide = side(shot.cameraPosition);
      const endSide = side(shot.cameraEndPosition);
      if (currentSide && endSide && currentSide !== endSide) {
        issues.push({ ruleId: "CON-005", severity: "warning", message: "运镜起止位于双人关系轴两侧，建议复核越轴意图。" });
      }
      const previousStart = previous && sequence.rows.findIndex((row) => row.id === previous.dialogueId);
      if (previous && previousStart !== undefined &&
        participants.every((participant) => participant.entryIndex <= previousStart) &&
        currentSide && side(previous.cameraEndPosition) && side(previous.cameraEndPosition) !== currentSide) {
        issues.push({ ruleId: "CON-005", severity: "warning", message: "与上一镜位于双人关系轴两侧，建议复核空间连续性。" });
      }
    }
    if (shot.cameraMovement !== "static") {
      const end = assessProjection({ position: shot.cameraEndPosition, target: shot.cameraEndTarget },
        subject, participants, shot.endFocalLength, measured.measuredShotSize, coverage, composition,
        undefined, shot.cameraRollDegrees);
      if (!end.visibleParticipantSlots.includes(subject.slot) || !end.subjectSafeForUltrawide) {
        issues.push({ ruleId: "MOV-006", severity: "warning", message: "运镜终点未完整保留发言角色，请结合移向其他主体的意图复核。" });
      }
    }
    reviews.push({ shotId: shot.id, dialogueIds: [...shot.dialogueIds], issues });
    previewShots.push({
      ...shot,
      // Rendering must retain the BP orientation, not generated actor turns.
      facingOverrides: {},
      dialogueEndIndex: startIndex,
      compositionPlan: composition,
      projection: { ...assessment, expectedShotSize: measured.measuredShotSize, coverage,
        eyeTraceDelta: null, issues, warnings: issues.map((issue) => issue.message),
        valid: !issues.some((issue) => issue.severity === "error") },
    });
  }
  return { reviews, previewShots };
}

export async function reviewExistingStoryboard(
  sequence: DialogueSequence,
  shots: ShotPlan[],
  signal: AbortSignal,
  onProgress: (message: string) => void,
  onRules: (report: ExistingStoryboardReview) => void,
): Promise<ExistingStoryboardReview> {
  const { reviews, previewShots } = inspectExistingStoryboard(sequence, shots);
  const report: ExistingStoryboardReview = { shots: reviews, message: "规则检查已完成，正在准备视觉评估。" };
  onRules(report);
  signal.throwIfAborted();
  if (!sequence.participants.every((participant) => participant.positionSource === "blueprint")) {
    return { ...report, message: "角色站位不完整，当前仅提供参考规则检查；读取有效 BP 站位后可重新评估模型画面。" };
  }
  onProgress("正在渲染已有镜头画面");
  const { renderRuleCandidateFrames } = await import("./candidateFrameRenderer");
  signal.throwIfAborted();
  const candidates: RuleCameraCandidateSet[] = previewShots.map((shot, index) => ({
    shotIndex: index, dialogueIds: shot.dialogueIds,
    candidates: [{
      candidateId: `existing-${index}`, shotIndex: index, geometryCandidateIndex: 0,
      label: "已有机位", isBaseline: true, legal: shot.projection.valid,
      cameraOverride: { position: shot.cameraPosition, target: shot.cameraTarget, composition: shot.compositionPlan },
      shot,
    }],
  }));
  const visuals = renderRuleCandidateFrames(sequence.participants, candidates);
  if (!visuals) return { ...report, message: "画面渲染失败，已保留规则检查；可重新评估。" };
  const input = createDirectorInput(sequence, `review-${sequence.prefix}-${crypto.randomUUID()}`, {
    preserveInputFormation: true, lockPlayerPosition: true, collectRevisionCases: false, soundEffectCatalog: [],
  });
  const request = ExistingStoryboardReviewRequestSchema.parse({
    purpose: "review_existing", input,
    baseline: { shots: shots.map((shot) => ({
      dialogue_ids: shot.dialogueIds, speaker: shot.speakerSlot, duration: shot.duration,
      camera_movement: shot.cameraMovement,
      camera_end_position: shot.cameraEndPosition, camera_end_target: shot.cameraEndTarget,
    })) },
    ...visuals,
  });
  signal.throwIfAborted();
  onProgress(`正在评估 ${shots.length} 个已有镜头`);
  const timer = window.setInterval(() => {
    if (!signal.aborted) void readAdvisorProgress(input.request_id, (progress) => {
      if (!signal.aborted && progress.request_id === input.request_id) {
        onProgress(`${progress.message} · ${progress.completed}/${progress.total}`);
      }
    });
  }, 1000);
  let response: Response;
  let envelope;
  try {
    response = await fetch("/api/rule-advisor/review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request), signal,
    });
    envelope = await response.json();
  } finally {
    window.clearInterval(timer);
  }
  const parsed = RuleAdvisorResponseSchema.safeParse(envelope.data);
  if (!response.ok || !envelope.ok || !parsed.success || parsed.data.request_id !== input.request_id) {
    return { ...report, message: "端侧模型不可用或评分无效，已保留规则检查；请检查设置中的端侧模型后重试。" };
  }
  const advice = parsed.data;
  // Never attach partial, duplicate or mismatched scores to a different shot.
  if (advice.visual_scores.length !== shots.length || candidates.some((set, index) =>
    advice.visual_scores.filter((score) => score.shot_index === index &&
      score.candidate_id === set.candidates[0].candidateId).length !== 1)) {
    return { ...report, message: "模型评分与已有镜头不匹配，已保留规则检查，请重新评估。" };
  }
  const result = reviews.map((review, index) => ({
    ...review, visual: advice.visual_scores.find((score) => score.shot_index === index)!,
  }));
  return {
    shots: result, model: advice.model,
    averageScore: Math.round(result.reduce((sum, review) => sum + review.visual.overall, 0) / result.length),
    message: `已完成 ${shots.length} 镜评估`,
  };
}
