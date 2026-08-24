import type { DialogueSequence, ShotPlan } from "../types";
import { createDefaultBlocking, resolveBlocking } from "./blockingResolver";
import {
  createDirectorInput,
  type DirectorSceneAnalysis,
} from "./contracts";
import {
  createRuleAnalysis,
  createRuleDecisions,
  reviseRuleDecisionsForProjection,
} from "./ruleDirector";
import { resolveShotDecisions } from "./shotResolver";

/**
 * Synchronous compatibility helper used for initial rendering and focused tests.
 * Interactive generation should call designShots() so Mira can degrade to rules.
 */
export function createShotPlan(sequence: DialogueSequence): ShotPlan[] {
  return createShotPreview(sequence).shots;
}

function projectionIssueScore(shots: ShotPlan[]): number {
  return shots.reduce(
    (score, shot) =>
      score +
      (shot.projection.valid ? 0 : 1_000) +
      shot.projection.warnings.length,
    0,
  );
}

export function resolveRuleShotsWithRetry(
  sequence: DialogueSequence,
  decisions: ReturnType<typeof createRuleDecisions>,
): ShotPlan[] {
  const initialShots = resolveShotDecisions(sequence, decisions);
  if (initialShots.every((shot) => shot.projection.valid)) {
    return initialShots;
  }

  try {
    const revisedShots = resolveShotDecisions(
      sequence,
      reviseRuleDecisionsForProjection(decisions, initialShots),
    );
    return projectionIssueScore(revisedShots) < projectionIssueScore(initialShots)
      ? revisedShots
      : initialShots;
  } catch {
    return initialShots;
  }
}

export function createShotPreview(
  sequence: DialogueSequence,
  options: { preserveInputPositions?: boolean } = {},
): {
  sequence: DialogueSequence;
  shots: ShotPlan[];
  blocking: ReturnType<typeof createDefaultBlocking>;
  analysis: DirectorSceneAnalysis;
} {
  const input = createDirectorInput(sequence, `${sequence.prefix}-rule`);
  const blocking = createDefaultBlocking(input);
  const participants = resolveBlocking(
    sequence.participants,
    blocking,
    sequence.rows.map((row) => row.id),
    options,
  );
  const stagedSequence = { ...sequence, participants };
  const decisions = createRuleDecisions(input, blocking);
  return {
    sequence: stagedSequence,
    shots: resolveRuleShotsWithRetry(stagedSequence, decisions),
    blocking,
    analysis: createRuleAnalysis(input),
  };
}
