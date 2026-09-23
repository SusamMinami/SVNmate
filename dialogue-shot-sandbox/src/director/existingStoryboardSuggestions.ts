import type { DialogueSequence, ShotPlan, Vec3 } from "../types";
import { createDirectorInput } from "./contracts";
import { inspectExistingStoryboard, type ExistingShotReview } from "./existingStoryboardReview";
import { solveGroupCamera, solveSingleCamera } from "./shotGeometry";
import type { RuleCameraCandidate, RuleCameraCandidateSet } from "./shotCandidateGenerator";
import { ExistingStoryboardReviewRequestSchema, RuleAdvisorResponseSchema } from "./ruleAdvisorContracts";
import { readAdvisorProgress } from "./ruleAdvisor";

export interface ExistingShotSuggestion {
  original: ShotPlan;
  proposed: ShotPlan;
  originalScore: number;
  proposedScore: number;
  reason: string;
  issues: string[];
  model: string;
}

function shifted(end: Vec3, before: Vec3, after: Vec3): Vec3 {
  return [0, 1, 2].map((axis) => end[axis] + after[axis] - before[axis]) as unknown as Vec3;
}

function candidate(shot: ShotPlan, index: number, baseline = false): RuleCameraCandidate {
  return {
    candidateId: `existing-${shot.index}-${index}`,
    shotIndex: shot.index, geometryCandidateIndex: index,
    label: baseline ? "原镜头" : `调整方案 ${index}`,
    isBaseline: baseline, legal: shot.projection.valid,
    cameraOverride: { position: shot.cameraPosition, target: shot.cameraTarget, composition: shot.compositionPlan },
    shot,
  };
}

/** Recheck the entire sequence, including the outgoing cut, before offering or adopting. */
export function applyExistingShotSuggestion(
  sequence: DialogueSequence, shots: ShotPlan[], original: ShotPlan, proposed: ShotPlan,
): ShotPlan[] | null {
  const index = shots.indexOf(original);
  if (index < 0 || proposed.id !== original.id) return null;
  const next = shots.map((shot, i) => i === index ? proposed : shot);
  const before = inspectExistingStoryboard(sequence, shots);
  const after = inspectExistingStoryboard(sequence, next);
  // A suggestion may resolve existing issues, but cannot introduce hard failures
  // or new continuity warnings in this shot or its neighbours.
  if (!after.previewShots[index].projection.valid || after.reviews.some((review, i) =>
    review.issues.some((issue) =>
      (issue.severity === "error" || issue.ruleId.startsWith("CON-") || issue.ruleId === "MOV-006") &&
      !before.reviews[i].issues.some((old) => old.ruleId === issue.ruleId && old.message === issue.message)))) return null;
  return next.map((shot, i) => ({
    ...shot, projection: after.previewShots[i].projection,
  }));
}

export function generateExistingShotCandidates(
  sequence: DialogueSequence, shots: ShotPlan[], shotId: string,
): RuleCameraCandidateSet | null {
  const index = shots.findIndex((shot) => shot.id === shotId);
  const original = shots[index];
  if (!original || !sequence.participants.every((p) => p.positionSource === "blueprint")) return null;
  const inspected = inspectExistingStoryboard(sequence, shots).previewShots[index];
  const start = sequence.rows.findIndex((row) => row.id === original.dialogueId);
  const participants = sequence.participants.filter((p) =>
    p.entryIndex <= start && (p.exitIndex === null || p.exitIndex >= start));
  const subject = participants.find((p) => p.slot === original.speakerSlot);
  if (!subject) return null;
  const candidates = [candidate({ ...inspected, index }, 0, true)];
  const seen = new Set([JSON.stringify([original.cameraPosition, original.cameraTarget])]);
  const group = inspected.projection.visibleParticipantSlots.length > 1;
  for (let attempt = 0; attempt < 12 && candidates.length < 3; attempt++) {
    try {
      const geometry = group
        ? solveGroupCamera({
          participants, lensMm: original.focalLength,
          cameraHeight: original.cameraPosition[1], shotSize: "medium-full",
          composition: inspected.compositionPlan, candidateIndex: attempt,
        })
        : solveSingleCamera({
          subject, participants, lensMm: original.focalLength,
          cameraHeight: original.cameraPosition[1],
          shotSize: inspected.projection.measuredShotSize,
          coverage: "single", composition: inspected.compositionPlan,
          cameraRollDegrees: original.cameraRollDegrees, candidateIndex: attempt,
        }).geometry;
      const key = JSON.stringify([geometry.position, geometry.target]);
      if (seen.has(key)) continue;
      seen.add(key);
      const proposed: ShotPlan = {
        ...original, cameraPosition: geometry.position, cameraTarget: geometry.target,
        cameraEndPosition: shifted(original.cameraEndPosition, original.cameraPosition, geometry.position),
        cameraEndTarget: shifted(original.cameraEndTarget, original.cameraTarget, geometry.target),
        facingOverrides: {},
        label: "已有镜头 · 调整草稿",
        rationale: "在已有镜头基础上调整机位，保留对白覆盖、时长、焦距和运镜位移。",
      };
      const checked = applyExistingShotSuggestion(sequence, shots, original, proposed);
      if (!checked) continue;
      // Preserve originally visible actors: don't silently replace a reaction
      // or relationship shot with a speaking-subject close-up.
      if (inspected.projection.visibleParticipantSlots.some((slot) =>
        !checked[index].projection.visibleParticipantSlots.includes(slot))) continue;
      // Sample the represented path as well as both endpoints. This is proxy
      // projection validation, not a claim about the original UE animation.
      let pathValid = true;
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const sample: ShotPlan = { ...proposed,
          cameraPosition: proposed.cameraPosition.map((v, a) =>
            v + (proposed.cameraEndPosition[a] - v) * t) as unknown as Vec3,
          cameraTarget: proposed.cameraTarget.map((v, a) =>
            v + (proposed.cameraEndTarget[a] - v) * t) as unknown as Vec3,
          focalLength: proposed.focalLength + (proposed.endFocalLength - proposed.focalLength) * t,
        };
        if (!inspectExistingStoryboard(sequence, [sample]).previewShots[0].projection.valid) {
          pathValid = false;
          break;
        }
      }
      if (!pathValid) continue;
      candidates.push(candidate({ ...checked[index], index, dialogueEndIndex: start }, candidates.length));
    } catch {
      // Bounded geometry search; unavailable solutions never become suggestions.
    }
  }
  return { shotIndex: index, dialogueIds: [...original.dialogueIds], candidates };
}

export async function suggestExistingShot(
  sequence: DialogueSequence, shots: ShotPlan[], review: ExistingShotReview,
  signal: AbortSignal, onProgress: (message: string) => void,
): Promise<{ suggestion?: ExistingShotSuggestion; message: string }> {
  signal.throwIfAborted();
  onProgress("正在求解可用调整方案");
  const set = generateExistingShotCandidates(sequence, shots, review.shotId);
  if (!set || set.candidates.length < 2) {
    return { message: "未找到通过几何检查的调整方案。请结合文字建议手动调整，或重读有效 BP 后重试。" };
  }
  const { renderRuleCandidateFrames } = await import("./candidateFrameRenderer");
  signal.throwIfAborted();
  const visuals = renderRuleCandidateFrames(sequence.participants, [set]);
  if (!visuals || visuals.candidate_frames.length !== set.candidates.length) {
    return { message: "候选画面未完整渲染，请重试。" };
  }
  const input = createDirectorInput(sequence, `suggest-${crypto.randomUUID()}`, {
    preserveInputFormation: true, lockPlayerPosition: true, collectRevisionCases: false, soundEffectCatalog: [],
  });
  const request = ExistingStoryboardReviewRequestSchema.parse({
    purpose: "suggest_existing", target_shot_index: set.shotIndex, input,
    feedback: [...review.issues.map((issue) => issue.message), ...(review.visual?.issues ?? [])].slice(0, 16),
    baseline: { shots: shots.map((shot) => ({
      dialogue_ids: shot.dialogueIds, speaker: shot.speakerSlot, duration: shot.duration,
      camera_movement: shot.cameraMovement,
      camera_position: shot.cameraPosition, camera_target: shot.cameraTarget, focal_length: shot.focalLength,
      camera_end_position: shot.cameraEndPosition, camera_end_target: shot.cameraEndTarget,
    })) }, ...visuals,
  });
  onProgress(`正在比较原镜头与 ${set.candidates.length - 1} 个调整方案`);
  const timer = window.setInterval(() => {
    if (!signal.aborted) void readAdvisorProgress(input.request_id, (progress) => {
      if (!signal.aborted && progress.request_id === input.request_id) {
        onProgress(`镜头 ${set.shotIndex + 1} · ${progress.message} · ${progress.completed}/${progress.total}`);
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
  signal.throwIfAborted();
  const parsed = RuleAdvisorResponseSchema.safeParse(envelope.data);
  if (!response.ok || !envelope.ok || !parsed.success || parsed.data.request_id !== input.request_id) {
    return { message: "模型未完成候选比较，请重试；原镜头保持不变。" };
  }
  const { visual_scores: scores, model } = parsed.data;
  if (scores.length !== set.candidates.length || set.candidates.some((c) =>
    scores.filter((s) => s.shot_index === set.shotIndex && s.candidate_id === c.candidateId &&
      s.is_baseline === c.isBaseline).length !== 1)) {
    return { message: "候选评分不完整或不匹配，请重试。" };
  }
  const baseline = scores.find((s) => s.is_baseline)!;
  const best = scores.filter((s) => !s.is_baseline && s.overall > baseline.overall)
    .sort((a, b) => b.overall - a.overall)[0];
  if (!best) return { message: "模型没有选出评分更高的可用方案，建议保留原镜头。" };
  const original = shots[set.shotIndex];
  const proposed = { ...set.candidates.find((c) => c.candidateId === best.candidate_id)!.shot,
    dialogueEndIndex: original.dialogueEndIndex };
  return {
    suggestion: { original, proposed, originalScore: baseline.overall, proposedScore: best.overall,
      reason: best.assessment, issues: best.issues, model },
    message: "调整建议已就绪；预览后可选择采纳或保留原镜头。",
  };
}
