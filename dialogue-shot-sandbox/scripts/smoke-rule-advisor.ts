import {
  createDefaultBlocking,
  resolveBlocking,
} from "../src/director/blockingResolver";
import { createDirectorInput } from "../src/director/contracts";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import { demoDatabase } from "../src/data/demo";
import {
  createRuleAnalysis,
  createRuleDecisions,
} from "../src/director/ruleDirector";
import { applyRuleCandidateRanking } from "../src/director/ruleAdvisor";
import { generateRuleCameraCandidates } from "../src/director/shotCandidateGenerator";
import { resolveRulePlanWithRetry } from "../src/director/shotPlanner";
import {
  RuleAdvisorResponseSchema,
  RuleBeatAdviceSchema,
} from "../src/director/ruleAdvisorContracts";

const endpoint =
  process.env.RULE_ADVISOR_SMOKE_URL ||
  "http://127.0.0.1:5173/api/rule-advisor/analyze";
const beatEndpoint = endpoint.replace(/\/analyze$/, "/beats");
const sequence = findDialogueSequence(demoDatabase, "2048");
const input = createDirectorInput(sequence, "rule-advisor-smoke");
const blocking = createDefaultBlocking(input);
const { sound_effect_catalog: _soundEffectCatalog, ...advisorInput } = input;
const blankImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlZl0sAAAAASUVORK5CYII=";

async function post(endpointUrl: string, body: unknown) {
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const envelope = (await response.json()) as {
    ok?: boolean;
    data?: unknown;
    error?: { message?: string };
  };
  if (!response.ok || !envelope.ok) {
    throw new Error(envelope.error?.message || `HTTP ${response.status}`);
  }
  return envelope.data;
}

const beatAdvice = RuleBeatAdviceSchema.parse(
  await post(beatEndpoint, { input: advisorInput }),
);
const beatDecisions = createRuleDecisions(input, blocking, beatAdvice);
const participants = resolveBlocking(
  sequence.participants,
  blocking,
  sequence.rows.map((row) => row.id),
);
const stagedSequence = { ...sequence, participants };
const baseline = resolveRulePlanWithRetry(stagedSequence, beatDecisions);
const candidateSets = generateRuleCameraCandidates(
  stagedSequence,
  baseline.decisions,
  baseline.shots,
);
const candidateFrames = candidateSets.flatMap((set) =>
  set.candidates.map((candidate) => ({
    candidate_id: candidate.candidateId,
    candidate_label: candidate.label,
    shot_index: candidate.shotIndex,
    dialogue_ids: candidate.shot.dialogueIds,
    is_baseline: candidate.isBaseline,
    legal: candidate.legal,
    camera: {
      position: [...candidate.shot.cameraPosition],
      target: [...candidate.shot.cameraTarget],
      focal_length: candidate.shot.focalLength,
      shot_size: candidate.shot.projection.measuredShotSize,
      coverage: candidate.shot.projection.coverage,
      visual_anchor: [...candidate.shot.projection.visualAnchor],
      headroom: candidate.shot.projection.headroom,
      look_room: candidate.shot.projection.lookRoom,
      projection_issues:
        candidate.shot.projection.issues
          ?.filter((issue) => issue.severity !== "info")
          .map((issue) => issue.message) ?? [],
    },
    image_data_url: blankImage,
  })),
);
const result = RuleAdvisorResponseSchema.parse(
  await post(endpoint, {
    input: advisorInput,
    baseline: {
      shots: baseline.decisions,
      analysis: createRuleAnalysis(input),
    },
    candidate_frames: candidateFrames,
  }),
);
const applied = applyRuleCandidateRanking(
  stagedSequence,
  {
    decisions: baseline.decisions,
    shots: baseline.shots,
    analysis: createRuleAnalysis(input),
  },
  candidateSets,
  result,
);

console.log(
  JSON.stringify(
    {
      requestId: result.request_id,
      beatSummary: beatAdvice.summary,
      beats: beatAdvice.beats,
      dialogueIssues: beatAdvice.dialogue_issues,
      summary: result.summary,
      reviewedShotCount: applied.reviewedShotCount,
      candidateCount: applied.candidateCount,
      selectedAlternativeCount: applied.selectedAlternativeCount,
      rankings: result.rankings,
      visualScores: result.visual_scores,
    },
    null,
    2,
  ),
);
