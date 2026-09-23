import { afterEach, describe, expect, it, vi } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import {
  createDefaultBlocking,
  resolveBlocking,
} from "./blockingResolver";
import { createDirectorInput } from "./contracts";
import {
  applyRuleCandidateRanking,
  requestRuleBeatAdvice,
  requestRuleMusicAdvice,
} from "./ruleAdvisor";
import type { RuleAdvisorResponse } from "./ruleAdvisorContracts";
import { generateRuleCameraCandidates } from "./shotCandidateGenerator";
import { createRuleAnalysis, createRuleDecisions } from "./ruleDirector";
import { resolveRulePlanWithRetry } from "./shotPlanner";

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("separate beat and music requests", () => {
  it("keeps music out of the beat payload and propagates cancellation", async () => {
    const input = createDirectorInput(findDialogueSequence(demoDatabase, "2048"));
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("music_catalog");
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(requestRuleBeatAdvice(input, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns no music on failure without requesting beats", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    const input = createDirectorInput(findDialogueSequence(demoDatabase, "2048"));
    expect(await requestRuleMusicAdvice(input)).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/rule-advisor/music");
  });
  it("sends the music catalog and existing UE music to the local advisor", async () => {
    const input = createDirectorInput(
      findDialogueSequence(demoDatabase, "2048"),
      "rule-music-test",
    );
    let requestBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            schema_version: "rule-beat.v1",
            request_id: input.request_id,
            summary: "建立关系后进入悬疑。",
            beats: [
              {
                start_dialogue_id: input.dialogue[0].dialogue_id,
                end_dialogue_id: input.dialogue.at(-1)!.dialogue_id,
                narrative_function: "development",
                intensity: 45,
                coverage_strategy: "relationship_hold",
                reason: "保持连续关系。",
              },
            ],
            dialogue_issues: [],
            music_cues: [
              {
                dialogue_id: input.dialogue[0].dialogue_id,
                state_id: 15,
                reason: "秘密逐渐暴露，建议使用悬疑配乐。",
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const advice = await requestRuleMusicAdvice(input, {
      musicCatalog: [
        {
          recordId: "music-15",
          name: "危机四伏",
          stateName: "Hidden_Crisis",
          stateId: 15,
          tags: ["悬疑"],
          notes: "逐步积累压力",
          fileToken: null,
          fileName: null,
          analysis: {
            estimatedBpm: 82,
            bpmSource: "音频估算",
            tempoConfidence: 0.7,
            integratedLufs: -22,
            loudnessRangeLu: 6,
            truePeakDbfs: -1,
            dynamicRangeDb: 11,
            spectralCentroidHz: 1_100,
            lowFrequencyRatio: 0.4,
            midFrequencyRatio: 0.5,
            highFrequencyRatio: 0.1,
            tempoLevel: "中",
            energyLevel: "中",
            brightness: "偏暗",
            summary: "中速、中能量、音色偏暗",
            recommendedUse: "叙事功能：悬疑调查；情绪：神秘",
            semanticProfile: {
              schemaVersion: "music-semantic-profile.v3",
              narrativeFunctions: ["悬疑调查"],
              moods: ["神秘"],
              valence: -0.3,
              arousal: 0.4,
              tension: 0.8,
              intensityTrajectory: "渐强",
              entryMode: "慢铺垫",
              dialogueFit: "高",
              specialUseOnly: false,
              confidence: 0.9,
            },
          },
        },
      ],
      existingConfigurations: [
        {
          dialogueId: input.dialogue[0].dialogue_id,
          cameraPosition: "",
          moveCameraCount: 0,
          cameraMoveTypes: [],
          fov: null,
          blendCameraType: "",
          blendCurve: "",
          blendDuration: 0,
          schoolCameraKeys: [],
          schoolCameraCount: 0,
          soundEffectAssetPath: "",
          soundEffectAssetName: "",
          soundEffectDelaySeconds: 0,
          backgroundMusicStateId: 18,
          backgroundMusicDelaySeconds: 0,
        },
      ],
    });

    expect(requestBody).toMatchObject({
      music_catalog: [
        {
          state_id: 15,
          state_name: "Hidden_Crisis",
          music_name: "危机四伏",
          recommended_use: "叙事功能：悬疑调查；情绪：神秘",
          semantic_profile: {
            schema_version: "music-semantic-profile.v3",
            narrative_functions: ["悬疑调查"],
            dialogue_fit: "高",
          },
        },
      ],
      existing_music: [
        {
          dialogue_id: input.dialogue[0].dialogue_id,
          state_id: 18,
        },
      ],
    });
    expect(advice).toEqual([
      expect.objectContaining({ state_id: 15 }),
    ]);
  });
});
