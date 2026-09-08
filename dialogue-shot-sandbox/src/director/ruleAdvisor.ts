import type {
  DialogueSequence,
  ShotAdvisorCandidateReview,
  ShotPlan,
} from "../types";
import type {
  DirectorDecision,
  DirectorInput,
  DirectorSceneAnalysis,
  RuleBeatAdvice,
} from "./contracts";
import type {
  RuleCameraCandidate,
  RuleCameraCandidateSet,
} from "./shotCandidateGenerator";
import type { RuleCandidateVisualSet } from "./candidateFrameRenderer";
import { resolveShotDecisions } from "./shotResolver";
import {
  RuleAdvisorProgressSchema,
  RuleAdvisorResponseSchema,
  RuleBeatAdviceSchema,
  type RuleAdvisorProgress,
  type RuleAdvisorResponse,
} from "./ruleAdvisorContracts";

interface AdvisorEnvelope {
  ok?: boolean;
  data?: unknown;
}

export interface AppliedRuleRanking {
  shots: ShotPlan[];
  analysis: DirectorSceneAnalysis;
  reviewedShotCount: number;
  candidateCount: number;
  selectedAlternativeCount: number;
  model: string;
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

export async function releaseIdleRuleAdvisorResources(): Promise<boolean> {
  try {
    const response = await fetch("/api/rule-advisor/release", {
      method: "POST",
    });
    if (!response.ok) {
      return false;
    }
    const envelope = (await response.json()) as AdvisorEnvelope;
    return (
      envelope.ok === true &&
      Boolean((envelope.data as { released?: unknown })?.released)
    );
  } catch {
    return false;
  }
}

async function readAdvisorProgress(
  requestId: string,
  onProgress: (progress: RuleAdvisorProgress) => void,
): Promise<void> {
  if (
    document.hidden ||
    document.querySelector(".app-shell")?.getAttribute(
      "data-configuration-mode",
    ) === "true" ||
    document.querySelector(".app-shell")?.getAttribute(
      "data-active-workspace",
    ) !== "storyboard"
  ) {
    return;
  }
  try {
    const response = await fetch(
      `/api/rule-advisor/progress?request_id=${encodeURIComponent(requestId)}`,
    );
    if (!response.ok) return;
    const envelope = (await response.json()) as AdvisorEnvelope;
    const parsed = RuleAdvisorProgressSchema.safeParse(envelope.data);
    if (envelope.ok && parsed.success) {
      onProgress(parsed.data);
    }
  } catch {
    // Progress is advisory; the main analysis request remains authoritative.
  }
}

export async function requestRuleAdvice(
  input: DirectorInput,
  baseline: {
    decisions: DirectorDecision[];
    analysis: DirectorSceneAnalysis;
  },
  candidateVisuals: RuleCandidateVisualSet,
  signal?: AbortSignal,
  onProgress?: (progress: RuleAdvisorProgress) => void,
): Promise<RuleAdvisorResponse | null> {
  const progressTimer = onProgress
    ? globalThis.setInterval(
        () => void readAdvisorProgress(input.request_id, onProgress),
        500,
      )
    : null;
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
  } finally {
    if (progressTimer !== null) {
      globalThis.clearInterval(progressTimer);
    }
  }
}

function selectedCandidateReview(
  candidate: RuleCameraCandidate,
  advice: RuleAdvisorResponse,
  selectedCandidateId: string,
): ShotAdvisorCandidateReview | null {
  const score = advice.visual_scores.find(
    (item) => item.candidate_id === candidate.candidateId,
  );
  if (!score) {
    return null;
  }
  return {
    candidateId: candidate.candidateId,
    label: candidate.label,
    score: score.overall,
    selected: candidate.candidateId === selectedCandidateId,
    baseline: candidate.isBaseline,
    composition: score.composition,
    subjectReadability: score.subject_readability,
    occlusion: score.occlusion,
    continuity: score.continuity,
    issues: [...score.issues],
    assessment: score.assessment,
  };
}

export function applyRuleCandidateRanking(
  sequence: DialogueSequence,
  baseline: {
    decisions: DirectorDecision[];
    shots: ShotPlan[];
    analysis: DirectorSceneAnalysis;
  },
  candidateSets: RuleCameraCandidateSet[],
  advice: RuleAdvisorResponse,
): AppliedRuleRanking {
  let shots = baseline.shots;
  const selectedOverrides = new Map<
    number,
    RuleCameraCandidate["cameraOverride"]
  >();
  const selectedIds = new Map<number, string>();
  const candidateById = new Map(
    candidateSets.flatMap((set) =>
      set.candidates.map((candidate) => [candidate.candidateId, candidate]),
    ),
  );

  for (const candidateSet of candidateSets) {
    const ranking = advice.rankings.find(
      (item) => item.shot_index === candidateSet.shotIndex,
    );
    const candidateIds =
      ranking?.ranked_candidate_ids ??
      candidateSet.candidates.map((candidate) => candidate.candidateId);
    let selected: RuleCameraCandidate | null = null;

    for (const candidateId of candidateIds) {
      const candidate = candidateById.get(candidateId);
      if (
        !candidate ||
        candidate.shotIndex !== candidateSet.shotIndex ||
        !candidate.legal
      ) {
        continue;
      }
      const trialOverrides = new Map(selectedOverrides);
      trialOverrides.set(candidateSet.shotIndex, candidate.cameraOverride);
      try {
        const trialShots = resolveShotDecisions(sequence, baseline.decisions, {
          cameraOverrides: trialOverrides,
        });
        if (
          trialShots
            .slice(0, candidateSet.shotIndex + 1)
            .every((shot) => shot.projection.valid)
        ) {
          selectedOverrides.set(
            candidateSet.shotIndex,
            candidate.cameraOverride,
          );
          selected = candidate;
          shots = trialShots;
          break;
        }
      } catch {
        // Try the next VLM-ranked legal geometry.
      }
    }

    const fallback =
      candidateSet.candidates.find((candidate) => candidate.isBaseline) ??
      candidateSet.candidates[0];
    selectedIds.set(
      candidateSet.shotIndex,
      selected?.candidateId ?? fallback.candidateId,
    );
  }

  const selectedAlternativeCount = candidateSets.filter((candidateSet) => {
    const selectedId = selectedIds.get(candidateSet.shotIndex);
    return candidateSet.candidates.some(
      (candidate) =>
        candidate.candidateId === selectedId && !candidate.isBaseline,
    );
  }).length;
  const selectedScores = advice.visual_scores.filter(
    (score) => selectedIds.get(score.shot_index) === score.candidate_id,
  );
  const averageScore =
    selectedScores.length > 0
      ? Math.round(
          selectedScores.reduce((sum, score) => sum + score.overall, 0) /
            selectedScores.length,
        )
      : 0;
  const rankingByShot = new Map(
    advice.rankings.map((ranking) => [ranking.shot_index, ranking]),
  );

  shots = shots.map((shot) => {
    const candidateSet = candidateSets[shot.index];
    const selectedCandidateId =
      selectedIds.get(shot.index) ??
      candidateSet?.candidates[0]?.candidateId ??
      "";
    const ranking = rankingByShot.get(shot.index);
    const candidates = (candidateSet?.candidates ?? [])
      .map((candidate) =>
        selectedCandidateReview(candidate, advice, selectedCandidateId),
      )
      .filter(
        (candidate): candidate is ShotAdvisorCandidateReview =>
          candidate !== null,
      )
      .sort(
        (left, right) =>
          Number(right.selected) - Number(left.selected) ||
          right.score - left.score,
      );
    const selectedCandidate = candidateSet?.candidates.find(
      (candidate) => candidate.candidateId === selectedCandidateId,
    );
    const selectedReview = candidates.find((candidate) => candidate.selected);
    const selectionReason =
      ranking &&
      ranking.selected_candidate_id !== selectedCandidateId
        ? `VLM 首选未通过组合验收，改用 ${selectedCandidate?.label ?? "下一候选"}：${
            selectedReview?.assessment ?? "该机位保持全序列合法"
          }`
        : selectedReview?.assessment ??
          ranking?.reason ??
          (selectedCandidate?.legal
            ? "综合视觉评分最高"
            : "没有其他通过几何验收的机位");
    return {
      ...shot,
      rationale: selectedCandidate?.isBaseline
        ? shot.rationale
        : `${shot.rationale} 端侧模型从合法机位中选择：${selectionReason}`,
      advisorReview: {
        model: advice.model,
        selectedAlternative: selectedCandidate?.isBaseline === false,
        reason: selectionReason,
        candidates,
      },
    };
  });

  return {
    shots,
    analysis: {
      ...baseline.analysis,
      visualStrategy: `${baseline.analysis.visualStrategy}；${advice.model} 已逐张检查 ${candidateSets.length} 个镜头、${advice.visual_scores.length} 个合法机位，${selectedAlternativeCount} 镜采用非基线候选，选中机位均分 ${averageScore}`,
    },
    reviewedShotCount: candidateSets.length,
    candidateCount: advice.visual_scores.length,
    selectedAlternativeCount,
    model: advice.model,
  };
}
