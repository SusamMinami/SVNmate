import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import {
  createDefaultBlocking,
  resolveBlocking,
} from "./blockingResolver";
import { createDirectorInput } from "./contracts";
import { applyRuleCandidateRanking } from "./ruleAdvisor";
import type { RuleAdvisorResponse } from "./ruleAdvisorContracts";
import { generateRuleCameraCandidates } from "./shotCandidateGenerator";
import { createRuleAnalysis, createRuleDecisions } from "./ruleDirector";
import { resolveRulePlanWithRetry } from "./shotPlanner";

function fixture() {
  const sequence = findDialogueSequence(demoDatabase, "2048");
  const input = createDirectorInput(sequence, "rule-advisor-test");
  const blocking = createDefaultBlocking(input);
  const participants = resolveBlocking(
    sequence.participants,
    blocking,
    sequence.rows.map((row) => row.id),
  );
  const stagedSequence = { ...sequence, participants };
  const decisions = createRuleDecisions(input, blocking);
  const baseline = resolveRulePlanWithRetry(stagedSequence, decisions);
  const candidateSets = generateRuleCameraCandidates(
    stagedSequence,
    baseline.decisions,
    baseline.shots,
  );
  return {
    input,
    sequence: stagedSequence,
    analysis: createRuleAnalysis(input),
    baseline,
    candidateSets,
  };
}

function adviceFor(
  data: ReturnType<typeof fixture>,
  selectAlternative: boolean,
): RuleAdvisorResponse {
  const visualScores = data.candidateSets.flatMap((set) =>
    set.candidates.map((candidate, index) => ({
      shot_index: set.shotIndex,
      candidate_id: candidate.candidateId,
      candidate_label: candidate.label,
      is_baseline: candidate.isBaseline,
      composition: 82 + index,
      subject_readability: 84 + index,
      occlusion: 86 + index,
      continuity: 80 + index,
      overall: 83 + index,
      issues: [],
      assessment: `${candidate.label} 通过视觉检查`,
    })),
  );
  return {
    schema_version: "rule-camera-ranking.v1",
    request_id: data.input.request_id,
    model: "qwen3-vl:4b",
    summary: "逐镜候选评分完成",
    visual_scores: visualScores,
    rankings: data.candidateSets.map((set) => {
      const selected =
        selectAlternative
          ? (set.candidates.find((candidate) => !candidate.isBaseline) ??
            set.candidates[0])
          : (set.candidates.find((candidate) => candidate.isBaseline) ??
            set.candidates[0]);
      return {
        shot_index: set.shotIndex,
        selected_candidate_id: selected.candidateId,
        ranked_candidate_ids: [
          selected.candidateId,
          ...set.candidates
            .filter(
              (candidate) => candidate.candidateId !== selected.candidateId,
            )
            .map((candidate) => candidate.candidateId),
        ],
        reason: `${selected.label} 综合视觉评分最高`,
      };
    }),
  };
}

describe("rule advisor camera ranking", () => {
  it("generates at least one inspected camera for every shot", () => {
    const data = fixture();

    expect(data.candidateSets).toHaveLength(data.baseline.shots.length);
    expect(
      data.candidateSets.every((set) => set.candidates.length >= 1),
    ).toBe(true);
    expect(
      data.candidateSets
        .flatMap((set) => set.candidates)
        .filter((candidate) => candidate.legal)
        .every((candidate) => candidate.shot.projection.valid),
    ).toBe(true);
  });

  it("applies VLM-ranked legal geometries and records per-shot evidence", () => {
    const data = fixture();
    const result = applyRuleCandidateRanking(
      data.sequence,
      {
        decisions: data.baseline.decisions,
        shots: data.baseline.shots,
        analysis: data.analysis,
      },
      data.candidateSets,
      adviceFor(data, true),
    );

    expect(result.reviewedShotCount).toBe(data.baseline.shots.length);
    expect(result.candidateCount).toBeGreaterThanOrEqual(
      data.baseline.shots.length,
    );
    expect(result.shots.every((shot) => shot.advisorReview)).toBe(true);
    expect(
      result.shots.every(
        (shot) =>
          shot.advisorReview?.candidates.filter(
            (candidate) => candidate.selected,
          ).length === 1,
      ),
    ).toBe(true);
    expect(result.shots.every((shot) => shot.projection.valid)).toBe(true);
    expect(result.analysis.visualStrategy).toContain("逐张检查");
  });
});
