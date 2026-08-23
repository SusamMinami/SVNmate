import type { DialogueSequence, ShotPlan } from "../types";
import { createDefaultBlocking, resolveBlocking } from "./blockingResolver";
import {
  createDirectorInput,
  type DirectorSceneAnalysis,
} from "./contracts";
import {
  createRuleAnalysis,
  createRuleDecisions,
} from "./ruleDirector";
import { resolveShotDecisions } from "./shotResolver";

/**
 * Synchronous compatibility helper used for initial rendering and focused tests.
 * Interactive generation should call designShots() so Mira can degrade to rules.
 */
export function createShotPlan(sequence: DialogueSequence): ShotPlan[] {
  return createShotPreview(sequence).shots;
}

export function createShotPreview(sequence: DialogueSequence): {
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
  );
  const stagedSequence = { ...sequence, participants };
  return {
    sequence: stagedSequence,
    shots: resolveShotDecisions(
      stagedSequence,
      createRuleDecisions(input, blocking),
    ),
    blocking,
    analysis: createRuleAnalysis(input),
  };
}
