import {
  DirectorDecisionSchema,
  type DirectorDecision,
  type DirectorInput,
  type DirectorSceneAnalysis,
  type RuleBeatAdvice,
} from "./contracts";
import {
  RuleBeatAdviceSchema,
  RuleAdvisorResponseSchema,
  type RuleAdvisorResponse,
} from "./ruleAdvisorContracts";
import type { RuleCandidateVisualSet } from "./candidateFrameRenderer";

interface AdvisorEnvelope {
  ok?: boolean;
  data?: unknown;
}

export interface AppliedRuleAdvice {
  decisions: DirectorDecision[];
  analysis: DirectorSceneAnalysis;
  appliedAdjustmentCount: number;
}

function compactAdvisorInput(input: DirectorInput) {
  const { sound_effect_catalog: _soundEffectCatalog, ...advisorInput } = input;
  return advisorInput;
}

export async function requestRuleBeatAdvice(
  input: DirectorInput,
  signal?: AbortSignal,
): Promise<RuleBeatAdvice | null> {
  try {
    const response = await fetch("/api/rule-advisor/beats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: compactAdvisorInput(input) }),
      signal,
    });
    if (!response.ok) return null;
    const envelope = (await response.json()) as AdvisorEnvelope;
    const parsed = RuleBeatAdviceSchema.safeParse(envelope.data);
    if (
      !envelope.ok ||
      !parsed.success ||
      parsed.data.request_id !== input.request_id
    ) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function inferredLensIntent(lensMm: number): DirectorDecision["lens_intent"] {
  if (lensMm <= 35) return "spatial_context";
  if (lensMm <= 50) return "natural_perspective";
  if (lensMm <= 85) return "subject_isolation";
  return "compressed_intimacy";
}

export async function requestRuleAdvice(
  input: DirectorInput,
  baseline: {
    decisions: DirectorDecision[];
    analysis: DirectorSceneAnalysis;
  },
  candidateVisuals: RuleCandidateVisualSet,
  signal?: AbortSignal,
): Promise<RuleAdvisorResponse | null> {
  try {
    const response = await fetch("/api/rule-advisor/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: compactAdvisorInput(input),
        baseline: {
          shots: baseline.decisions,
          analysis: baseline.analysis,
        },
        ...candidateVisuals,
      }),
      signal,
    });
    if (!response.ok) {
      return null;
    }
    const envelope = (await response.json()) as AdvisorEnvelope;
    const parsed = RuleAdvisorResponseSchema.safeParse(envelope.data);
    if (!envelope.ok || !parsed.success ||
        parsed.data.request_id !== input.request_id) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function applyRuleAdvice(
  input: DirectorInput,
  baseline: {
    decisions: DirectorDecision[];
    analysis: DirectorSceneAnalysis;
  },
  advice: RuleAdvisorResponse,
): AppliedRuleAdvice {
  const participantSlots = new Set(
    input.participants
      .filter((participant) => participant.role === "dialogue")
      .map((participant) => participant.slot),
  );
  const decisions = baseline.decisions.map((decision) => ({ ...decision }));
  const visuallyScoredShots = new Set(
    advice.visual_scores.map((score) => score.shot_index),
  );
  let appliedAdjustmentCount = 0;
  const averageVisualScore =
    advice.visual_scores.length > 0
      ? Math.round(
          advice.visual_scores.reduce(
            (sum, score) => sum + score.overall,
            0,
          ) / advice.visual_scores.length,
        )
      : null;
  const visualSummary =
    averageVisualScore === null
      ? ""
      : `，候选画面 ${advice.visual_scores
          .map(
            (score) =>
              `SHOT ${String(score.shot_index + 1).padStart(2, "0")} ${score.overall}`,
          )
          .join(" / ")}，均分 ${averageVisualScore}`;

  for (const adjustment of advice.adjustments) {
    if (adjustment.confidence < 0.65) {
      continue;
    }
    if (!visuallyScoredShots.has(adjustment.shot_index)) {
      continue;
    }
    const original = decisions[adjustment.shot_index];
    if (!original) {
      continue;
    }
    const subject = adjustment.changes.subject;
    const lookTarget = adjustment.changes.look_target;
    if (
      (subject && subject !== "both" && subject !== "group" &&
        !participantSlots.has(subject)) ||
      (lookTarget && lookTarget !== "group_center" &&
        !participantSlots.has(lookTarget))
    ) {
      continue;
    }
    const changes = { ...adjustment.changes };
    if (
      changes.camera_movement === undefined &&
      changes.movement_intensity !== undefined
    ) {
      delete changes.movement_intensity;
    }
    if (changes.lens_mm !== undefined && changes.lens_intent === undefined) {
      changes.lens_intent = inferredLensIntent(changes.lens_mm);
    }
    const movement = changes.camera_movement ?? original.camera_movement;
    const changesFocalLength = [
      "zoom_in",
      "zoom_out",
      "dolly_zoom_in",
      "dolly_zoom_out",
    ].includes(movement);
    if (
      !changesFocalLength &&
      changes.end_lens_mm === undefined &&
      (changes.lens_mm !== undefined ||
        changes.camera_movement !== undefined)
    ) {
      changes.end_lens_mm = changes.lens_mm ?? original.lens_mm;
    }
    if (
      changes.camera_movement !== undefined &&
      changes.movement_intensity === undefined
    ) {
      changes.movement_intensity =
        changes.camera_movement === "static" ? "none" : "subtle";
    }
    const intent = `${original.intent} 端侧顾问：${adjustment.reason}`.slice(
      0,
      240,
    );
    const candidate = DirectorDecisionSchema.safeParse({
      ...original,
      ...changes,
      dialogue_ids: original.dialogue_ids,
      intent,
    });
    if (!candidate.success) {
      continue;
    }
    decisions[adjustment.shot_index] = candidate.data;
    appliedAdjustmentCount += 1;
  }

  return {
    decisions,
    appliedAdjustmentCount,
    analysis: advice.scene_analysis
      ? {
          dramaticGoal: advice.scene_analysis.dramatic_goal,
          emotionalProgression:
            advice.scene_analysis.emotional_progression,
          visualStrategy: `${advice.scene_analysis.visual_strategy}（端侧顾问有 ${appliedAdjustmentCount} 项调整通过结构校验${visualSummary}）`,
        }
      : {
          ...baseline.analysis,
          visualStrategy:
            `${baseline.analysis.visualStrategy}；端侧顾问有 ${appliedAdjustmentCount} 项调整通过结构校验${visualSummary}：${advice.summary}`,
        },
  };
}
