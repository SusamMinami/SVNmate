import type {
  DialogueSequence,
  ExistingDialogueNodeConfiguration,
  ShotAdvisorCandidateReview,
  ShotPlan,
} from "../types";
import {
  shortlistMusicCatalog,
  type MusicCatalogEntry,
} from "../data/musicCatalog";
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
  RuleMusicAdviceSchema,
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

function compactMusicNotes(notes: string): string {
  return notes.replace(/[；;]文件[:：][\s\S]*$/u, "").trim().slice(0, 500);
}

export async function requestRuleBeatAdvice(
  input: DirectorInput,
  options: { signal?: AbortSignal; forceRegenerate?: boolean } = {},
): Promise<RuleBeatAdvice | null> {
  try {
    options.signal?.throwIfAborted();
    const response = await fetch("/api/rule-advisor/beats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: compactAdvisorInput(input),
        force_regenerate: options.forceRegenerate,
      }),
      signal: options.signal,
    });
    if (!response.ok) return null;
    const envelope = (await response.json()) as AdvisorEnvelope;
    options.signal?.throwIfAborted();
    const parsed = RuleBeatAdviceSchema.safeParse(envelope.data);
    return envelope.ok && parsed.success && parsed.data.request_id === input.request_id
      ? parsed.data : null;
  } catch {
    options.signal?.throwIfAborted();
    return null;
  }
}

export async function requestRuleMusicAdvice(
  input: DirectorInput,
  options: {
    musicCatalog?: readonly MusicCatalogEntry[];
    existingConfigurations?: readonly ExistingDialogueNodeConfiguration[];
    signal?: AbortSignal;
    forceRegenerate?: boolean;
  } = {},
): Promise<RuleBeatAdvice["music_cues"] | null> {
  try {
    options.signal?.throwIfAborted();
    const existingMusic = (options.existingConfigurations ?? [])
      .flatMap((configuration) =>
        configuration.backgroundMusicStateId === null
          ? []
          : [{
              dialogue_id: configuration.dialogueId,
              state_id: configuration.backgroundMusicStateId,
            }],
      )
      .slice(0, 500);
    const musicCatalog = shortlistMusicCatalog(
      options.musicCatalog ?? [],
      {
        outline: input.outline,
        dialogue: input.dialogue,
        adjacentText: [
          input.adjacent_context.previous?.outline,
          ...(input.adjacent_context.previous?.dialogue.map(
            (line) => line.content,
          ) ?? []),
          input.adjacent_context.next?.outline,
          ...(input.adjacent_context.next?.dialogue.map(
            (line) => line.content,
          ) ?? []),
        ]
          .filter(Boolean)
          .join(" "),
      },
      existingMusic.map((item) => item.state_id),
    );
    const response = await fetch("/api/rule-advisor/music", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: compactAdvisorInput(input),
        force_regenerate: options.forceRegenerate,
        music_catalog: musicCatalog
          .filter(
            (entry) =>
              Number.isInteger(entry.stateId) &&
              entry.stateId > 0 &&
              entry.stateName.trim() &&
              entry.name.trim(),
          )
          .map((entry) => ({
            state_id: entry.stateId,
            state_name: entry.stateName.trim().slice(0, 128),
            music_name: entry.name.trim().slice(0, 256),
            tags: entry.tags
              .map((tag) => tag.trim().slice(0, 80))
              .filter(Boolean)
              .slice(0, 16),
            notes: compactMusicNotes(entry.notes),
            audio_summary:
              entry.analysis?.summary.trim().slice(0, 240) || null,
            recommended_use:
              entry.analysis?.recommendedUse?.trim().slice(0, 500) ?? "",
            semantic_profile: entry.analysis?.semanticProfile
              ? {
                  schema_version:
                    entry.analysis.semanticProfile.schemaVersion,
                  narrative_functions:
                    entry.analysis.semanticProfile.narrativeFunctions,
                  moods: entry.analysis.semanticProfile.moods,
                  valence: entry.analysis.semanticProfile.valence,
                  arousal: entry.analysis.semanticProfile.arousal,
                  tension: entry.analysis.semanticProfile.tension,
                  intensity_trajectory:
                    entry.analysis.semanticProfile.intensityTrajectory,
                  entry_mode: entry.analysis.semanticProfile.entryMode,
                  dialogue_fit: entry.analysis.semanticProfile.dialogueFit,
                  special_use_only:
                    entry.analysis.semanticProfile.specialUseOnly,
                  confidence: entry.analysis.semanticProfile.confidence,
                }
              : null,
          })),
        existing_music: existingMusic,
      }),
      signal: options.signal,
    });
    if (!response.ok) return null;
    const envelope = (await response.json()) as AdvisorEnvelope;
    options.signal?.throwIfAborted();
    const parsed = RuleMusicAdviceSchema.safeParse(envelope.data);
    if (
      !envelope.ok ||
      !parsed.success ||
      parsed.data.request_id !== input.request_id
    ) {
      return null;
    }
    return parsed.data.music_cues;
  } catch {
    options.signal?.throwIfAborted();
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

export async function readAdvisorProgress(
  requestId: string,
  onProgress: (progress: RuleAdvisorProgress) => void,
  signal?: AbortSignal,
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
      { signal },
    );
    if (!response.ok) return;
    const envelope = (await response.json()) as AdvisorEnvelope;
    const parsed = RuleAdvisorProgressSchema.safeParse(envelope.data);
    if (!signal?.aborted && envelope.ok && parsed.success &&
      parsed.data.request_id === requestId) {
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
  forceRegenerate = false,
): Promise<RuleAdvisorResponse | null> {
  let finished = false;
  const report = (progress: RuleAdvisorProgress) => {
    if (!finished && !signal?.aborted) onProgress?.(progress);
  };
  const progressTimer = onProgress
    ? globalThis.setInterval(
        () => void readAdvisorProgress(input.request_id, report, signal),
        500,
      )
    : null;
  try {
    signal?.throwIfAborted();
    const response = await fetch("/api/rule-advisor/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: compactAdvisorInput(input),
        force_regenerate: forceRegenerate,
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
    signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    return null;
  } finally {
    finished = true;
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
