import { z } from "zod";
import {
  MAX_DIALOGUE_PARTICIPANTS,
  PARTICIPANT_SLOTS,
  type DialogueSequence,
  type ParticipantSlot,
} from "../types";

export const DIRECTOR_TEMPLATES = [
  "master_two_shot",
  "profile_two_shot",
  "master_group_shot",
  "speaker_group_medium",
  "reverse_medium",
  "close_up",
  "reaction_closeup",
  "low_angle_closeup",
  "high_angle_closeup",
] as const;

export const BLOCKING_FORMATIONS = [
  "arc",
  "triangle",
  "cluster",
  "opposed_groups",
  "leader_front",
] as const;

export const BLOCKING_POSITIONS = [
  "front_center",
  "front_left",
  "front_right",
  "mid_center",
  "mid_left",
  "mid_right",
  "back_center",
  "back_left",
  "back_right",
  "far_left",
  "far_right",
  "rear_center",
] as const;

export const ParticipantSlotSchema = z.enum(PARTICIPANT_SLOTS);

export const DirectorBlockingSchema = z.object({
  formation: z.enum(BLOCKING_FORMATIONS),
  intent: z.string().min(2).max(500),
  placements: z
    .array(
      z.object({
        subject: ParticipantSlotSchema,
        position: z.enum(BLOCKING_POSITIONS),
        facing: z.union([
          ParticipantSlotSchema,
          z.literal("group_center"),
        ]),
        entry_dialogue_id: z.string().min(1),
        exit_dialogue_id: z.string().min(1).nullable(),
        intent: z.string().min(2).max(240),
      }),
    )
    .min(2)
    .max(MAX_DIALOGUE_PARTICIPANTS),
});

export const REQUIRED_CONTEXTS = [
  "npc_background",
  "npc_relationship",
  "scene_layout",
  "story_before",
  "story_after",
] as const;

export const DirectorDecisionSchema = z.object({
  dialogue_ids: z.array(z.string().min(1)).min(1),
  template: z.enum(DIRECTOR_TEMPLATES),
  subject: z.union([
    ParticipantSlotSchema,
    z.literal("both"),
    z.literal("group"),
  ]),
  lens_mm: z.number().min(24).max(100),
  screen_position: z.enum([
    "left_third",
    "right_third",
    "center",
    "balanced",
  ]),
  camera_height: z.enum(["low", "eye", "high"]),
  intent: z.string().min(2).max(240),
});

export const MiraReadyResponseSchema = z.object({
  schema_version: z.literal("shot-plan.v1"),
  request_id: z.string().min(1),
  status: z.literal("ready"),
  scene_analysis: z.object({
    dramatic_goal: z.string().min(1).max(500),
    emotional_progression: z.string().min(1).max(500),
    visual_strategy: z.string().min(1).max(500),
  }),
  blocking: DirectorBlockingSchema,
  shots: z.array(DirectorDecisionSchema).min(1),
});

export const MiraNeedContextResponseSchema = z.object({
  schema_version: z.literal("shot-plan.v1"),
  request_id: z.string().min(1),
  status: z.literal("need_context"),
  required_context: z.array(z.enum(REQUIRED_CONTEXTS)).min(1),
  reason: z.string().min(1).max(500),
});

export const MiraDirectorResponseSchema = z.discriminatedUnion("status", [
  MiraReadyResponseSchema,
  MiraNeedContextResponseSchema,
]);

export const DirectorInputSchema = z.object({
  request_id: z.string().min(1),
  schema_version: z.literal("shot-plan.v1"),
  dialogue_prefix: z.string().regex(/^\d{4}$/),
  start_id: z.string().min(4),
  outline: z.string(),
  participants: z
    .array(
      z.object({
        slot: ParticipantSlotSchema,
        npc_id: z.number().int().positive(),
        name: z.string().min(1),
        background: z.string(),
        first_dialogue_id: z.string().min(1),
        last_dialogue_id: z.string().min(1),
      }),
    )
    .min(2)
    .max(MAX_DIALOGUE_PARTICIPANTS),
  dialogue: z
    .array(
      z.object({
        dialogue_id: z.string().min(1),
        speaker: ParticipantSlotSchema,
        speaker_name: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .min(1),
  adjacent_context: z.object({
    previous: z
      .object({
        dialogue_prefix: z.string().regex(/^\d{4}$/),
        start_id: z.string().min(4),
        outline: z.string(),
        dialogue: z.array(
          z.object({
            dialogue_id: z.string().min(1),
            npc_id: z.number().int().positive(),
            speaker_name: z.string().min(1),
            content: z.string().min(1),
          }),
        ),
      })
      .nullable(),
    next: z
      .object({
        dialogue_prefix: z.string().regex(/^\d{4}$/),
        start_id: z.string().min(4),
        outline: z.string(),
        dialogue: z.array(
          z.object({
            dialogue_id: z.string().min(1),
            npc_id: z.number().int().positive(),
            speaker_name: z.string().min(1),
            content: z.string().min(1),
          }),
        ),
      })
      .nullable(),
  }),
  constraints: z.object({
    preserve_axis: z.literal(true),
    primary_aspect_ratio: z.literal("16:9"),
    overlay_aspect_ratio: z.literal("21:9"),
    avoid_character_overlap: z.literal(true),
    supported_templates: z.array(z.enum(DIRECTOR_TEMPLATES)).min(1),
    max_characters: z
      .number()
      .int()
      .min(2)
      .max(MAX_DIALOGUE_PARTICIPANTS),
    output_language: z.literal("zh-CN"),
  }),
});

export type DirectorDecision = z.infer<typeof DirectorDecisionSchema>;
export type DirectorBlocking = z.infer<typeof DirectorBlockingSchema>;
export type MiraDirectorResponse = z.infer<typeof MiraDirectorResponseSchema>;
export type DirectorMode = "rule" | "trae" | "mira";
export type AppliedDirector = DirectorMode;

export interface DirectorInput {
  request_id: string;
  schema_version: "shot-plan.v1";
  dialogue_prefix: string;
  start_id: string;
  outline: string;
  participants: Array<{
    slot: ParticipantSlot;
    npc_id: number;
    name: string;
    background: string;
    first_dialogue_id: string;
    last_dialogue_id: string;
  }>;
  dialogue: Array<{
    dialogue_id: string;
    speaker: ParticipantSlot;
    speaker_name: string;
    content: string;
  }>;
  adjacent_context: {
    previous: {
      dialogue_prefix: string;
      start_id: string;
      outline: string;
      dialogue: Array<{
        dialogue_id: string;
        npc_id: number;
        speaker_name: string;
        content: string;
      }>;
    } | null;
    next: {
      dialogue_prefix: string;
      start_id: string;
      outline: string;
      dialogue: Array<{
        dialogue_id: string;
        npc_id: number;
        speaker_name: string;
        content: string;
      }>;
    } | null;
  };
  constraints: {
    preserve_axis: true;
    primary_aspect_ratio: "16:9";
    overlay_aspect_ratio: "21:9";
    avoid_character_overlap: true;
    supported_templates: ReadonlyArray<(typeof DIRECTOR_TEMPLATES)[number]>;
    max_characters: number;
    output_language: "zh-CN";
  };
}

export interface DirectorSceneAnalysis {
  dramaticGoal: string;
  emotionalProgression: string;
  visualStrategy: string;
}

export type ReadyDirectorResponse = Extract<
  MiraDirectorResponse,
  { status: "ready" }
>;

export interface SharedStoryboardConflict {
  recordId: string;
  input: DirectorInput;
  plan: ReadyDirectorResponse;
}

export interface DirectorProviderResult {
  decisions: DirectorDecision[];
  analysis?: DirectorSceneAnalysis;
  blocking: DirectorBlocking;
  rawPlan?: ReadyDirectorResponse;
  sharedSource?: "generated" | "local-cache" | "shared-library";
  sharedConflict?: SharedStoryboardConflict;
}

export interface ShotDirectorProvider {
  readonly id: DirectorMode;
  design(input: DirectorInput): Promise<DirectorProviderResult>;
}

export function createDirectorInput(
  sequence: DialogueSequence,
  requestId = `${sequence.prefix}-${Date.now()}`,
): DirectorInput {
  const participantById = new Map(
    sequence.participants.map((participant) => [participant.id, participant]),
  );
  return {
    request_id: requestId,
    schema_version: "shot-plan.v1",
    dialogue_prefix: sequence.prefix,
    start_id: sequence.startId,
    outline: sequence.outline,
    participants: sequence.participants.map((participant) => ({
      slot: participant.slot,
      npc_id: participant.id,
      name: participant.name,
      background:
        participant.introduction || participant.note || "暂无补充角色背景",
      first_dialogue_id: participant.firstDialogueId,
      last_dialogue_id: participant.lastDialogueId,
    })),
    dialogue: sequence.rows.flatMap((row) => {
      const participant =
        row.npcId === null ? undefined : participantById.get(row.npcId);
      if (!participant) {
        return [];
      }
      return [
        {
          dialogue_id: row.id,
          speaker: participant.slot,
          speaker_name: participant.name,
          content: row.content,
        },
      ];
    }),
    adjacent_context: {
      previous: sequence.adjacentContext.previous
        ? {
            dialogue_prefix: sequence.adjacentContext.previous.prefix,
            start_id: sequence.adjacentContext.previous.startId,
            outline: sequence.adjacentContext.previous.outline,
            dialogue: sequence.adjacentContext.previous.dialogue.map(
              (line) => ({
                dialogue_id: line.dialogueId,
                npc_id: line.npcId,
                speaker_name: line.speakerName,
                content: line.content,
              }),
            ),
          }
        : null,
      next: sequence.adjacentContext.next
        ? {
            dialogue_prefix: sequence.adjacentContext.next.prefix,
            start_id: sequence.adjacentContext.next.startId,
            outline: sequence.adjacentContext.next.outline,
            dialogue: sequence.adjacentContext.next.dialogue.map(
              (line) => ({
                dialogue_id: line.dialogueId,
                npc_id: line.npcId,
                speaker_name: line.speakerName,
                content: line.content,
              }),
            ),
          }
        : null,
    },
    constraints: {
      preserve_axis: true,
      primary_aspect_ratio: "16:9",
      overlay_aspect_ratio: "21:9",
      avoid_character_overlap: true,
      supported_templates: DIRECTOR_TEMPLATES,
      max_characters: sequence.participants.length,
      output_language: "zh-CN",
    },
  };
}
