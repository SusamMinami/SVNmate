import { z } from "zod";
import {
  MAX_DIALOGUE_PARTICIPANTS,
  PARTICIPANT_SLOTS,
  type DialogueParticipant,
  type DialogueSequence,
  type ParticipantSlot,
  type Vec3,
} from "../types";
import {
  MAX_SOUND_EFFECT_CATALOG_ENTRIES,
  SOUND_EFFECT_CATEGORIES,
  soundEffectCatalogForDirector,
  type SoundEffectCategory,
  type SoundEffectCatalogEntry,
} from "../data/soundEffectCatalog";
import {
  participantFacingYawDegrees,
  SUPPORTED_ACTOR_TURN_DEGREES,
} from "./actorActionPlanner";

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

export const COMPOSITION_MODES = [
  "center",
  "rule_of_thirds",
  "golden_ratio",
  "symmetry",
  "asymmetrical_balance",
  "triangular",
  "negative_space",
  "layered_depth",
] as const;

export const VISUAL_ANCHORS = [
  "center",
  "left_third",
  "right_third",
  "left_golden",
  "right_golden",
  "balanced",
] as const;

export const NEGATIVE_SPACE_MODES = [
  "balanced",
  "look_room",
  "isolation",
  "pressure",
] as const;

export const COMPOSITION_TRANSITIONS = [
  "recenter",
  "match_eye_trace",
  "mirror_reverse",
  "progressive_shift",
  "contrast",
] as const;

export const COVERAGE_INTENTS = [
  "establish_geography",
  "reestablish_geography",
  "relationship",
  "shared_reaction",
  "individual_perspective",
  "individual_emphasis",
  "reaction",
] as const;

export const CAMERA_MOVEMENTS = [
  "static",
  "pan",
  "tracking",
  "dolly_in",
  "dolly_out",
  "zoom_in",
  "zoom_out",
  "dolly_zoom_in",
  "dolly_zoom_out",
] as const;

export const MOVEMENT_INTENSITIES = [
  "none",
  "subtle",
  "moderate",
  "strong",
] as const;

export const LENS_INTENTS = [
  "spatial_context",
  "natural_perspective",
  "subject_isolation",
  "compressed_intimacy",
  "perspective_distortion",
] as const;

export const DEPTH_OF_FIELD_MODES = [
  "deep",
  "moderate",
  "shallow",
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

export const DirectorDecisionSchema = z
  .object({
    dialogue_ids: z.array(z.string().min(1)).min(1),
    template: z.enum(DIRECTOR_TEMPLATES),
    subject: z.union([
      ParticipantSlotSchema,
      z.literal("both"),
      z.literal("group"),
    ]),
    look_target: z.union([
      ParticipantSlotSchema,
      z.literal("group_center"),
    ]),
    lens_mm: z.number().min(24).max(135),
    end_lens_mm: z.number().min(24).max(135),
    lens_intent: z.enum(LENS_INTENTS),
    depth_of_field: z.enum(DEPTH_OF_FIELD_MODES),
    camera_movement: z.enum(CAMERA_MOVEMENTS),
    movement_intensity: z.enum(MOVEMENT_INTENSITIES),
    camera_roll_degrees: z.number().min(-45).max(45),
    composition_mode: z.enum(COMPOSITION_MODES),
    visual_anchor: z.enum(VISUAL_ANCHORS),
    negative_space: z.enum(NEGATIVE_SPACE_MODES),
    composition_transition: z.enum(COMPOSITION_TRANSITIONS),
    coverage_intent: z.enum(COVERAGE_INTENTS),
    camera_height: z.enum(["low", "eye", "high"]),
    intent: z.string().min(2).max(240),
  })
  .superRefine((shot, context) => {
    const moving = shot.camera_movement !== "static";
    if (moving === (shot.movement_intensity === "none")) {
      context.addIssue({
        code: "custom",
        path: ["movement_intensity"],
        message:
          shot.camera_movement === "static"
            ? "静态镜头的 movement_intensity 必须为 none"
            : "运动镜头的 movement_intensity 不能为 none",
      });
    }
    const changesFocalLength = [
      "zoom_in",
      "zoom_out",
      "dolly_zoom_in",
      "dolly_zoom_out",
    ].includes(shot.camera_movement);
    if (!changesFocalLength && shot.end_lens_mm !== shot.lens_mm) {
      context.addIssue({
        code: "custom",
        path: ["end_lens_mm"],
        message: "只有 zoom 或 dolly zoom 可以在镜内改变焦距",
      });
    }
    if (
      shot.camera_movement === "zoom_in" &&
      shot.end_lens_mm <= shot.lens_mm
    ) {
      context.addIssue({
        code: "custom",
        path: ["end_lens_mm"],
        message: "zoom_in 必须增加焦距",
      });
    }
    if (
      shot.camera_movement === "zoom_out" &&
      shot.end_lens_mm >= shot.lens_mm
    ) {
      context.addIssue({
        code: "custom",
        path: ["end_lens_mm"],
        message: "zoom_out 必须缩短焦距",
      });
    }
    if (
      shot.camera_movement === "dolly_zoom_in" &&
      shot.end_lens_mm >= shot.lens_mm
    ) {
      context.addIssue({
        code: "custom",
        path: ["end_lens_mm"],
        message: "dolly_zoom_in 必须在推进时同步缩短焦距",
      });
    }
    if (
      shot.camera_movement === "dolly_zoom_out" &&
      shot.end_lens_mm <= shot.lens_mm
    ) {
      context.addIssue({
        code: "custom",
        path: ["end_lens_mm"],
        message: "dolly_zoom_out 必须在后退时同步增加焦距",
      });
    }
    if (
      shot.camera_roll_degrees !== 0 &&
      Math.abs(shot.camera_roll_degrees) < 10
    ) {
      context.addIssue({
        code: "custom",
        path: ["camera_roll_degrees"],
        message: "Dutch angle 应为 0 或至少倾斜 10 度，避免意外歪斜",
      });
    }
    const lensRanges: Record<
      (typeof LENS_INTENTS)[number],
      readonly [number, number]
    > = {
      spatial_context: [24, 35],
      natural_perspective: [35, 50],
      subject_isolation: [50, 85],
      compressed_intimacy: [85, 135],
      perspective_distortion: [24, 35],
    };
    const [minimumLens, maximumLens] = lensRanges[shot.lens_intent];
    if (
      shot.lens_mm < minimumLens ||
      shot.lens_mm > maximumLens
    ) {
      context.addIssue({
        code: "custom",
        path: ["lens_intent"],
        message: `${shot.lens_intent} 与 ${shot.lens_mm}mm 焦段不匹配`,
      });
    }
  });

export const DirectorRevisionReflectionSchema = z.object({
  shot_index: z.number().int().positive(),
  summary: z.string().min(2).max(500),
  root_cause: z.string().min(2).max(500),
  strategy: z.string().min(2).max(500),
  applies_when: z.string().min(2).max(500),
  avoid_when: z.string().min(2).max(500),
});

export const DirectorSoundEffectCueSchema = z.object({
  dialogue_id: z.string().min(1),
  asset_name: z.string().min(1).max(160),
  category: z.enum(SOUND_EFFECT_CATEGORIES),
  reason: z.string().min(2).max(240),
});

export const MiraReadyResponseSchema = z.object({
  schema_version: z.literal("shot-plan.v5"),
  request_id: z.string().min(1),
  status: z.literal("ready"),
  scene_analysis: z.object({
    dramatic_goal: z.string().min(1).max(500),
    emotional_progression: z.string().min(1).max(500),
    visual_strategy: z.string().min(1).max(500),
  }),
  blocking: DirectorBlockingSchema,
  shots: z.array(DirectorDecisionSchema).min(1),
  sound_effects: z.array(DirectorSoundEffectCueSchema).max(16),
  revision_reflections: z
    .array(DirectorRevisionReflectionSchema)
    .max(24)
    .optional(),
});

export const MiraNeedContextResponseSchema = z.object({
  schema_version: z.literal("shot-plan.v5"),
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
  schema_version: z.literal("shot-plan.v5"),
  dialogue_prefix: z.string().regex(/^\d{4}$/),
  start_id: z.string().min(4),
  outline: z.string(),
  participants: z
    .array(
      z.object({
        slot: ParticipantSlotSchema,
        npc_id: z.number().int().positive(),
        instance_id: z.string().min(1).optional(),
        model_index: z.number().int().nonnegative().nullable().optional(),
        model_class_path: z.string().startsWith("/Game/").max(512).optional(),
        name: z.string().min(1),
        background: z.string(),
        role: z.enum(["dialogue", "background"]).default("dialogue"),
        initial_position: z.tuple([z.number(), z.number(), z.number()]).optional(),
        initial_facing_target: z
          .tuple([z.number(), z.number(), z.number()])
          .optional(),
        initial_yaw_degrees: z.number().min(-180).max(180).optional(),
        can_turn: z.boolean().optional(),
        position_source: z.enum(["generated", "blueprint"]).optional(),
        first_dialogue_id: z.string().min(1),
        last_dialogue_id: z.string().min(1),
        entry_dialogue_id: z.string().min(1).optional(),
        exit_dialogue_id: z.string().min(1).nullable().optional(),
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
  sound_effect_catalog: z
    .array(
      z.object({
        category: z.enum(SOUND_EFFECT_CATEGORIES),
        asset_name: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .max(MAX_SOUND_EFFECT_CATALOG_ENTRIES)
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
    dynamic_relationship_axis: z.literal(true),
    composition_projection_validation: z.literal(true),
    relationship_coverage: z.literal(true),
    motivated_camera_movement: z.literal(true),
    lens_semantics: z.literal(true),
    primary_aspect_ratio: z.literal("16:9"),
    overlay_aspect_ratio: z.literal("21:9"),
    avoid_character_overlap: z.literal(true),
    preserve_input_formation: z.boolean().optional(),
    collect_revision_cases: z.boolean().optional(),
    supported_templates: z.array(z.enum(DIRECTOR_TEMPLATES)).min(1),
    supported_camera_movements: z
      .array(z.enum(CAMERA_MOVEMENTS))
      .min(1),
    supported_lens_intents: z.array(z.enum(LENS_INTENTS)).min(1),
    supported_depth_of_field: z
      .array(z.enum(DEPTH_OF_FIELD_MODES))
      .min(1),
    supported_actor_turn_degrees: z
      .array(z.number().refine((value) =>
        (SUPPORTED_ACTOR_TURN_DEGREES as readonly number[]).includes(value),
      ))
      .optional(),
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
export type DirectorRevisionReflection = z.infer<
  typeof DirectorRevisionReflectionSchema
>;
export type DirectorSoundEffectCue = z.infer<
  typeof DirectorSoundEffectCueSchema
>;
export type MiraDirectorResponse = z.infer<typeof MiraDirectorResponseSchema>;
export type DirectorMode = "rule" | "trae" | "mira";
export type AppliedDirector = DirectorMode;

export interface DirectorInput {
  request_id: string;
  schema_version: "shot-plan.v5";
  dialogue_prefix: string;
  start_id: string;
  outline: string;
  participants: Array<{
    slot: ParticipantSlot;
    npc_id: number;
    instance_id?: string;
    model_index?: number | null;
    model_class_path?: string;
    name: string;
    background: string;
    role: "dialogue" | "background";
    initial_position?: Vec3;
    initial_facing_target?: Vec3;
    initial_yaw_degrees?: number;
    can_turn?: boolean;
    position_source?: "generated" | "blueprint";
    first_dialogue_id: string;
    last_dialogue_id: string;
    entry_dialogue_id?: string;
    exit_dialogue_id?: string | null;
  }>;
  dialogue: Array<{
    dialogue_id: string;
    speaker: ParticipantSlot;
    speaker_name: string;
    content: string;
  }>;
  sound_effect_catalog: Array<{
    category: SoundEffectCategory;
    asset_name: string;
    description: string;
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
    dynamic_relationship_axis: true;
    composition_projection_validation: true;
    relationship_coverage: true;
    motivated_camera_movement: true;
    lens_semantics: true;
    primary_aspect_ratio: "16:9";
    overlay_aspect_ratio: "21:9";
    avoid_character_overlap: true;
    preserve_input_formation?: boolean;
    collect_revision_cases?: boolean;
    supported_templates: ReadonlyArray<(typeof DIRECTOR_TEMPLATES)[number]>;
    supported_camera_movements: ReadonlyArray<
      (typeof CAMERA_MOVEMENTS)[number]
    >;
    supported_lens_intents: ReadonlyArray<
      (typeof LENS_INTENTS)[number]
    >;
    supported_depth_of_field: ReadonlyArray<
      (typeof DEPTH_OF_FIELD_MODES)[number]
    >;
    supported_actor_turn_degrees?: ReadonlyArray<number>;
    max_characters: number;
    output_language: "zh-CN";
  };
}

export interface DirectorSceneAnalysis {
  dramaticGoal: string;
  emotionalProgression: string;
  visualStrategy: string;
}

export function directorDialogueParticipants(
  input: Pick<DirectorInput, "participants">,
): DirectorInput["participants"] {
  return input.participants.filter(
    (participant) => participant.role === "dialogue",
  );
}

export interface DirectorSoundEffectRecommendation {
  dialogueId: string;
  assetName: string;
  category: SoundEffectCategory;
  reason: string;
  description: string;
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
  soundEffects: DirectorSoundEffectRecommendation[];
  rawPlan?: ReadyDirectorResponse;
  sharedSource?: "generated" | "local-cache" | "shared-library";
  sharedConflict?: SharedStoryboardConflict;
}

export interface ShotDirectorProvider {
  readonly id: DirectorMode;
  design(
    input: DirectorInput,
    options?: { forceRegenerate?: boolean },
  ): Promise<DirectorProviderResult>;
}

export function createDirectorInput(
  sequence: DialogueSequence,
  requestId = `${sequence.prefix}-${Date.now()}`,
  options: {
    preserveInputFormation?: boolean;
    collectRevisionCases?: boolean;
    soundEffectCatalog?: readonly SoundEffectCatalogEntry[];
  } = {},
): DirectorInput {
  const participantById = new Map<number, DialogueParticipant>();
  const participantBySlot = new Map(
    sequence.participants.map((participant) => [participant.slot, participant]),
  );
  for (const participant of sequence.participants) {
    if (!participantById.has(participant.id)) {
      participantById.set(participant.id, participant);
    }
  }
  const dialogueParticipantSlots = new Set(
    sequence.rows.flatMap((row) => {
      const participant =
        (row.speakerSlot
          ? participantBySlot.get(row.speakerSlot)
          : undefined) ??
        (row.npcId === null ? undefined : participantById.get(row.npcId));
      return participant ? [participant.slot] : [];
    }),
  );
  return {
    request_id: requestId,
    schema_version: "shot-plan.v5",
    dialogue_prefix: sequence.prefix,
    start_id: sequence.startId,
    outline: sequence.outline,
    participants: sequence.participants.map((participant) => ({
      slot: participant.slot,
      npc_id: participant.id,
      instance_id: participant.instanceId,
      model_index: participant.modelIndex,
      model_class_path: participant.modelClassPath,
      name: participant.name,
      background:
        participant.introduction || participant.note || "暂无补充角色背景",
      role: dialogueParticipantSlots.has(participant.slot)
        ? "dialogue"
        : "background",
      initial_position: participant.position,
      initial_facing_target: participant.facingTarget,
      initial_yaw_degrees: participantFacingYawDegrees(participant),
      can_turn: participant.canTurn !== false,
      position_source: participant.positionSource,
      first_dialogue_id: participant.firstDialogueId,
      last_dialogue_id: participant.lastDialogueId,
      entry_dialogue_id: participant.entryDialogueId,
      exit_dialogue_id: participant.exitDialogueId,
    })),
    dialogue: sequence.rows.flatMap((row) => {
      const participant =
        (row.speakerSlot
          ? participantBySlot.get(row.speakerSlot)
          : undefined) ??
        (row.npcId === null ? undefined : participantById.get(row.npcId));
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
    sound_effect_catalog: options.soundEffectCatalog
      ? soundEffectCatalogForDirector(options.soundEffectCatalog)
      : soundEffectCatalogForDirector(),
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
      dynamic_relationship_axis: true,
      composition_projection_validation: true,
      relationship_coverage: true,
      motivated_camera_movement: true,
      lens_semantics: true,
      primary_aspect_ratio: "16:9",
      overlay_aspect_ratio: "21:9",
      avoid_character_overlap: true,
      preserve_input_formation:
        options.preserveInputFormation ??
        sequence.participants.every(
          (participant) => participant.positionSource === "blueprint",
        ),
      collect_revision_cases: options.collectRevisionCases ?? true,
      supported_templates: DIRECTOR_TEMPLATES,
      supported_camera_movements: CAMERA_MOVEMENTS,
      supported_lens_intents: LENS_INTENTS,
      supported_depth_of_field: DEPTH_OF_FIELD_MODES,
      supported_actor_turn_degrees: SUPPORTED_ACTOR_TURN_DEGREES,
      max_characters: sequence.participants.length,
      output_language: "zh-CN",
    },
  };
}
