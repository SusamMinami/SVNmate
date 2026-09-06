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
import { applyRuleAdvice } from "../src/director/ruleAdvisor";
import {
  projectionIssueScore,
  resolveRuleShotsWithRetry,
} from "../src/director/shotPlanner";
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
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    input: advisorInput,
    baseline: {
      shots: beatDecisions,
      analysis: createRuleAnalysis(input),
    },
    candidate_frames: [
      {
        shot_index: 0,
        dialogue_ids: [sequence.rows[0].id],
        image_data_url:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlZl0sAAAAASUVORK5CYII=",
      },
    ],
  }),
});
const envelope = (await response.json()) as {
  ok?: boolean;
  data?: unknown;
  error?: { message?: string };
};
if (!response.ok || !envelope.ok) {
  throw new Error(
    envelope.error?.message || `HTTP ${response.status}`,
  );
}
const result = RuleAdvisorResponseSchema.parse(envelope.data);
const baseline = {
  decisions: beatDecisions,
  analysis: createRuleAnalysis(input),
};
const applied = applyRuleAdvice(input, baseline, result);
const participants = resolveBlocking(
  sequence.participants,
  blocking,
  sequence.rows.map((row) => row.id),
);
const stagedSequence = { ...sequence, participants };
const baselineShots = resolveRuleShotsWithRetry(
  stagedSequence,
  baseline.decisions,
);
const advisedShots = resolveRuleShotsWithRetry(
  stagedSequence,
  applied.decisions,
);
const baselineProjectionScore = projectionIssueScore(baselineShots);
const advisedProjectionScore = projectionIssueScore(advisedShots);
console.log(
  JSON.stringify(
    {
      requestId: result.request_id,
      beatSummary: beatAdvice.summary,
      beats: beatAdvice.beats,
      summary: result.summary,
      adjustmentCount: result.adjustments.length,
      appliedAdjustmentCount: applied.appliedAdjustmentCount,
      baselineProjectionScore,
      advisedProjectionScore,
      advisorSelected: advisedProjectionScore <= baselineProjectionScore,
      visualScores: result.visual_scores,
      adjustments: result.adjustments,
    },
    null,
    2,
  ),
);
