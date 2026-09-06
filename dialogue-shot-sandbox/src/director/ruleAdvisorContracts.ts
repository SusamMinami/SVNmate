import { z } from "zod";
import {
  CAMERA_MOVEMENTS,
  COMPOSITION_MODES,
  COMPOSITION_TRANSITIONS,
  COVERAGE_INTENTS,
  DEPTH_OF_FIELD_MODES,
  DIRECTOR_TEMPLATES,
  DirectorDecisionSchema,
  DirectorInputSchema,
  LENS_INTENTS,
  MOVEMENT_INTENSITIES,
  NEGATIVE_SPACE_MODES,
  ParticipantSlotSchema,
  RULE_BEAT_COVERAGE_STRATEGIES,
  RULE_BEAT_FUNCTIONS,
  VISUAL_ANCHORS,
} from "./contracts";

export const RuleBeatRequestSchema = z.object({
  input: DirectorInputSchema.omit({ sound_effect_catalog: true }),
});

export const RuleBeatAdviceSchema = z.object({
  schema_version: z.literal("rule-beat.v1"),
  request_id: z.string().min(1),
  summary: z.string().min(1).max(500),
  beats: z
    .array(
      z.object({
        start_dialogue_id: z.string().min(1),
        end_dialogue_id: z.string().min(1),
        narrative_function: z.enum(RULE_BEAT_FUNCTIONS),
        intensity: z.number().int().min(0).max(100),
        coverage_strategy: z.enum(RULE_BEAT_COVERAGE_STRATEGIES),
        focus_slot: ParticipantSlotSchema.optional(),
        reason: z.string().min(2).max(240),
      }),
    )
    .min(1)
    .max(12),
});

export const RuleAdvisorChangesSchema = z
  .object({
    template: z.enum(DIRECTOR_TEMPLATES).optional(),
    subject: z
      .union([
        ParticipantSlotSchema,
        z.literal("both"),
        z.literal("group"),
      ])
      .optional(),
    look_target: z
      .union([ParticipantSlotSchema, z.literal("group_center")])
      .optional(),
    lens_mm: z.number().min(24).max(135).optional(),
    end_lens_mm: z.number().min(24).max(135).optional(),
    lens_intent: z.enum(LENS_INTENTS).optional(),
    depth_of_field: z.enum(DEPTH_OF_FIELD_MODES).optional(),
    camera_movement: z.enum(CAMERA_MOVEMENTS).optional(),
    movement_intensity: z.enum(MOVEMENT_INTENSITIES).optional(),
    camera_roll_degrees: z.number().min(-45).max(45).optional(),
    composition_mode: z.enum(COMPOSITION_MODES).optional(),
    visual_anchor: z.enum(VISUAL_ANCHORS).optional(),
    negative_space: z.enum(NEGATIVE_SPACE_MODES).optional(),
    composition_transition: z.enum(COMPOSITION_TRANSITIONS).optional(),
    coverage_intent: z.enum(COVERAGE_INTENTS).optional(),
    camera_height: z.enum(["low", "eye", "high"]).optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "changes 至少包含一个镜头字段",
  });

export const RuleAdvisorRequestSchema = z.object({
  input: DirectorInputSchema.omit({ sound_effect_catalog: true }),
  baseline: z.object({
    shots: z.array(DirectorDecisionSchema).min(1),
    analysis: z.object({
      dramaticGoal: z.string(),
      emotionalProgression: z.string(),
      visualStrategy: z.string(),
    }),
  }),
  candidate_frames: z
    .array(
      z.object({
        shot_index: z.number().int().nonnegative(),
        dialogue_ids: z.array(z.string().min(1)).min(1),
        image_data_url: z
          .string()
          .regex(/^data:image\/(?:jpeg|png);base64,/)
          .max(1_000_000),
      }),
    )
    .min(1)
    .max(8),
});

export const RuleVisualScoreSchema = z.object({
  shot_index: z.number().int().nonnegative(),
  composition: z.number().int().min(0).max(100),
  subject_readability: z.number().int().min(0).max(100),
  occlusion: z.number().int().min(0).max(100),
  continuity: z.number().int().min(0).max(100),
  overall: z.number().int().min(0).max(100),
  issues: z.array(z.string().min(1).max(160)).max(4),
});

export const RuleAdvisorPlanSchema = z.object({
  schema_version: z.literal("rule-advice.v1"),
  request_id: z.string().min(1),
  summary: z.string().min(1).max(500),
  scene_analysis: z
    .object({
      dramatic_goal: z.string().min(1).max(500),
      emotional_progression: z.string().min(1).max(500),
      visual_strategy: z.string().min(1).max(500),
    })
    .optional(),
  adjustments: z
    .array(
      z.object({
        shot_index: z.number().int().nonnegative(),
        confidence: z.number().min(0).max(1),
        reason: z.string().min(2).max(240),
        changes: RuleAdvisorChangesSchema,
      }),
    )
    .max(8),
});

export const RuleAdvisorResponseSchema = RuleAdvisorPlanSchema.extend({
  visual_scores: z.array(RuleVisualScoreSchema).min(1).max(8),
});

export type RuleAdvisorRequest = z.infer<typeof RuleAdvisorRequestSchema>;
export type RuleAdvisorResponse = z.infer<typeof RuleAdvisorResponseSchema>;
export type RuleBeatRequest = z.infer<typeof RuleBeatRequestSchema>;
