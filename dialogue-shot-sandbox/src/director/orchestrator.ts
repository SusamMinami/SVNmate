import type {
  DialogueParticipant,
  DialogueSequence,
  ParticipantSlot,
  ShotPlan,
} from "../types";
import { resolveBlocking } from "./blockingResolver";
import {
  createDirectorInput,
  type DirectorInput,
  type DirectorBlocking,
  type DirectorMode,
  type ReadyDirectorResponse,
  type DirectorSceneAnalysis,
  type SharedStoryboardConflict,
} from "./contracts";
import { MiraDirectorProvider } from "./miraDirector";
import { RuleDirectorProvider } from "./ruleDirector";
import { resolveShotDecisions } from "./shotResolver";
import { TraeDirectorProvider } from "./traeDirector";

const SHARED_PREVIEW_COLORS = [
  "#e85d47",
  "#268bd2",
  "#2f9d68",
  "#d69024",
  "#8a63c7",
  "#16a0a5",
  "#cc4f87",
  "#64748b",
  "#a06b3b",
  "#4f72c4",
  "#6f8f32",
  "#b94a5b",
] as const;

export interface DirectorRunResult {
  shots: ShotPlan[];
  requestedMode: DirectorMode;
  appliedMode: DirectorMode;
  fallbackReason: string | null;
  analysis?: DirectorSceneAnalysis;
  blocking: DirectorBlocking;
  participants: DialogueParticipant[];
  input: DirectorInput;
  rawPlan?: ReadyDirectorResponse;
  sharedSource?: "generated" | "local-cache" | "shared-library";
  sharedConflict?: SharedStoryboardConflict;
}

interface DirectorRunOptions {
  preserveInputPositions?: boolean;
  fallbackPreserveInputPositions?: boolean;
}

const providers = {
  rule: new RuleDirectorProvider(),
  trae: new TraeDirectorProvider(),
  mira: new MiraDirectorProvider(),
} as const;

async function runProvider(
  sequence: DialogueSequence,
  mode: DirectorMode,
  options: DirectorRunOptions = {},
): Promise<Omit<DirectorRunResult, "requestedMode" | "fallbackReason">> {
  const input = createDirectorInput(sequence, undefined, {
    preserveInputFormation: options.preserveInputPositions,
  });
  const providerResult = await providers[mode].design(input);
  const participants = resolveBlocking(
    sequence.participants,
    providerResult.blocking,
    sequence.rows.map((row) => row.id),
    options,
  );
  const stagedSequence = { ...sequence, participants };
  const shots = resolveShotDecisions(
    stagedSequence,
    providerResult.decisions,
  );
  if (shots.length === 0) {
    throw new Error(`${mode} 导演没有生成镜头`);
  }
  return {
    shots,
    appliedMode: mode,
    analysis: providerResult.analysis,
    blocking: providerResult.blocking,
    participants,
    input,
    rawPlan: providerResult.rawPlan,
    sharedSource: providerResult.sharedSource,
    sharedConflict: providerResult.sharedConflict,
  };
}

export async function designShots(
  sequence: DialogueSequence,
  requestedMode: DirectorMode,
  options: DirectorRunOptions = {},
): Promise<DirectorRunResult> {
  if (requestedMode === "rule") {
    return {
      ...(await runProvider(sequence, "rule", options)),
      requestedMode,
      fallbackReason: null,
    };
  }

  try {
    return {
      ...(await runProvider(sequence, requestedMode, options)),
      requestedMode,
      fallbackReason: null,
    };
  } catch (error) {
    const fallbackReason =
      error instanceof Error
        ? error.message
        : `${requestedMode === "trae" ? "TRAE" : "Mira"} AI 导演调用失败`;
    return {
      ...(await runProvider(sequence, "rule", {
        preserveInputPositions:
          options.fallbackPreserveInputPositions ??
          options.preserveInputPositions,
      })),
      requestedMode,
      fallbackReason,
    };
  }
}

function sequenceFromDirectorInput(input: DirectorInput): DialogueSequence {
  const npcIdBySlot = new Map(
    input.participants.map((participant) => [
      participant.slot,
      participant.npc_id,
    ]),
  );
  return {
    prefix: input.dialogue_prefix,
    startId: input.start_id,
    outline: input.outline,
    rows: input.dialogue.map((line, index) => ({
      id: line.dialogue_id,
      npcId: npcIdBySlot.get(line.speaker) ?? null,
      content: line.content,
      nextId: input.dialogue[index + 1]?.dialogue_id ?? null,
      isEnd: index === input.dialogue.length - 1,
      rowNumber: index + 1,
      speakerSlot: line.speaker,
      speakerModelIndex: null,
      relativeTransformsString: "",
      characterBehaviourString: "",
    })),
    participants: input.participants.map((participant, index) => {
      const firstDialogueIndex = input.dialogue.findIndex(
        (line) => line.dialogue_id === participant.first_dialogue_id,
      );
      const lastDialogueIndex = input.dialogue.findIndex(
        (line) => line.dialogue_id === participant.last_dialogue_id,
      );
      return {
        id: participant.npc_id,
        name: participant.name,
        note: participant.background,
        introduction: participant.background,
        resourceId: null,
        instanceId: participant.instance_id ?? `shared:${participant.slot}`,
        slot: participant.slot as ParticipantSlot,
        color: SHARED_PREVIEW_COLORS[index],
        position: participant.initial_position ?? ([0, 0, 0] as const),
        facingTarget:
          participant.initial_facing_target ?? ([0, 0, 0] as const),
        modelIndex: participant.model_index ?? null,
        positionSource: participant.position_source ?? "generated",
        firstDialogueId: participant.first_dialogue_id,
        firstDialogueIndex,
        lastDialogueId: participant.last_dialogue_id,
        lastDialogueIndex,
        entryDialogueId: participant.first_dialogue_id,
        entryIndex: firstDialogueIndex,
        exitDialogueId: null,
        exitIndex: null,
      };
    }),
    adjacentContext: {
      previous: input.adjacent_context.previous
        ? {
            prefix: input.adjacent_context.previous.dialogue_prefix,
            startId: input.adjacent_context.previous.start_id,
            outline: input.adjacent_context.previous.outline,
            dialogue: input.adjacent_context.previous.dialogue.map((line) => ({
              dialogueId: line.dialogue_id,
              npcId: line.npc_id,
              speakerName: line.speaker_name,
              content: line.content,
            })),
          }
        : null,
      next: input.adjacent_context.next
        ? {
            prefix: input.adjacent_context.next.dialogue_prefix,
            startId: input.adjacent_context.next.start_id,
            outline: input.adjacent_context.next.outline,
            dialogue: input.adjacent_context.next.dialogue.map((line) => ({
              dialogueId: line.dialogue_id,
              npcId: line.npc_id,
              speakerName: line.speaker_name,
              content: line.content,
            })),
          }
        : null,
    },
    warnings: [],
    formation: null,
  };
}

export function createSharedPlanPreview(
  input: DirectorInput,
  plan: ReadyDirectorResponse,
): {
  sequence: DialogueSequence;
  result: DirectorRunResult;
} {
  const sequence = sequenceFromDirectorInput(input);
  const participants = resolveBlocking(
    sequence.participants,
    plan.blocking,
    sequence.rows.map((row) => row.id),
    {
      preserveInputPositions:
        input.constraints.preserve_input_formation === true,
    },
  );
  const stagedSequence = { ...sequence, participants };
  return {
    sequence: stagedSequence,
    result: {
      shots: resolveShotDecisions(stagedSequence, plan.shots),
      requestedMode: "trae",
      appliedMode: "trae",
      fallbackReason: null,
      analysis: {
        dramaticGoal: plan.scene_analysis.dramatic_goal,
        emotionalProgression: plan.scene_analysis.emotional_progression,
        visualStrategy: plan.scene_analysis.visual_strategy,
      },
      blocking: plan.blocking,
      participants,
      input,
      rawPlan: plan,
      sharedSource: "shared-library",
    },
  };
}
