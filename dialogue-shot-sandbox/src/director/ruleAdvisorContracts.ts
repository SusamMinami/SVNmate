import { z } from "zod";
import {
  DirectorDecisionSchema,
  DirectorInputSchema,
  ParticipantSlotSchema,
  RULE_BEAT_COVERAGE_STRATEGIES,
  RULE_BEAT_FUNCTIONS,
  RULE_DIALOGUE_ISSUE_CATEGORIES,
  RULE_DIALOGUE_ISSUE_SEVERITIES,
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
  dialogue_issues: z
    .array(
      z.object({
        dialogue_id: z.string().min(1),
        category: z.enum(RULE_DIALOGUE_ISSUE_CATEGORIES),
        severity: z.enum(RULE_DIALOGUE_ISSUE_SEVERITIES),
        reason: z.string().min(2).max(240),
        suggestion: z.string().min(2).max(240).optional(),
      }),
    )
    .max(16)
    .default([]),
});

const CameraCandidateFrameSchema = z.object({
  candidate_id: z.string().min(1).max(80),
  candidate_label: z.string().min(1).max(80),
  shot_index: z.number().int().nonnegative(),
  dialogue_ids: z.array(z.string().min(1)).min(1),
  is_baseline: z.boolean(),
  legal: z.boolean(),
  camera: z.object({
    position: z.tuple([z.number(), z.number(), z.number()]),
    target: z.tuple([z.number(), z.number(), z.number()]),
    focal_length: z.number().min(1).max(300),
    shot_size: z.enum([
      "full",
      "medium-full",
      "medium",
      "medium-close-up",
      "close-up",
      "extreme-close-up",
    ]),
    coverage: z.enum([
      "single",
      "over-the-shoulder",
      "two-shot",
      "group",
      "group-medium",
    ]),
    visual_anchor: z.tuple([z.number(), z.number()]),
    headroom: z.number().nullable(),
    look_room: z.number().nullable(),
    projection_issues: z.array(z.string().min(1).max(240)).max(16),
  }),
  image_data_url: z
    .string()
    .regex(/^data:image\/(?:jpeg|png);base64,/)
    .max(1_000_000),
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
  candidate_frames: z.array(CameraCandidateFrameSchema).min(1),
}).superRefine((request, context) => {
  const candidateIds = new Set<string>();
  const shotIndexes = new Set<number>();
  for (const [index, frame] of request.candidate_frames.entries()) {
    if (candidateIds.has(frame.candidate_id)) {
      context.addIssue({
        code: "custom",
        path: ["candidate_frames", index, "candidate_id"],
        message: `候选 ID 重复：${frame.candidate_id}`,
      });
    }
    candidateIds.add(frame.candidate_id);
    shotIndexes.add(frame.shot_index);
  }
  for (let shotIndex = 0; shotIndex < request.baseline.shots.length; shotIndex += 1) {
    if (!shotIndexes.has(shotIndex)) {
      context.addIssue({
        code: "custom",
        path: ["candidate_frames"],
        message: `镜头 ${shotIndex + 1} 缺少视觉候选`,
      });
    }
  }
});

export const RuleCandidateVisualAssessmentSchema = z.object({
  composition: z.number().int().min(0).max(100),
  subject_readability: z.number().int().min(0).max(100),
  occlusion: z.number().int().min(0).max(100),
  continuity: z.number().int().min(0).max(100),
  issues: z.array(z.string().min(1).max(160)).max(4),
  assessment: z.string().min(2).max(240),
});

export const RuleVisualScoreSchema =
  RuleCandidateVisualAssessmentSchema.extend({
    shot_index: z.number().int().nonnegative(),
    candidate_id: z.string().min(1).max(80),
    candidate_label: z.string().min(1).max(80),
    is_baseline: z.boolean(),
    overall: z.number().int().min(0).max(100),
  });

export const RuleCandidateRankingSchema = z.object({
  shot_index: z.number().int().nonnegative(),
  selected_candidate_id: z.string().min(1).max(80),
  ranked_candidate_ids: z.array(z.string().min(1).max(80)).min(1).max(8),
  reason: z.string().min(1).max(500),
});

export const RuleAdvisorResponseSchema = z.object({
  schema_version: z.literal("rule-camera-ranking.v1"),
  request_id: z.string().min(1),
  model: z.string().min(1),
  summary: z.string().min(1).max(500),
  visual_scores: z.array(RuleVisualScoreSchema).min(1),
  rankings: z.array(RuleCandidateRankingSchema).min(1),
});

export const RuleAdvisorProgressSchema = z.object({
  request_id: z.string().min(1),
  stage: z.enum([
    "beats",
    "generating_candidates",
    "scoring_candidates",
    "complete",
    "unavailable",
  ]),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  current_shot_index: z.number().int().nonnegative().nullable(),
  current_candidate_label: z.string().nullable(),
  message: z.string().min(1),
});

export type RuleAdvisorRequest = z.infer<typeof RuleAdvisorRequestSchema>;
export type RuleAdvisorResponse = z.infer<typeof RuleAdvisorResponseSchema>;
export type RuleAdvisorProgress = z.infer<typeof RuleAdvisorProgressSchema>;
export type RuleBeatRequest = z.infer<typeof RuleBeatRequestSchema>;
