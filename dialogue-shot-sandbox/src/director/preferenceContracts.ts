import { z } from "zod";
import { DirectorInputSchema } from "./contracts";

export const DIRECTOR_PREFERENCE_TYPES = [
  "accept",
  "reject",
  "manual_edit",
  "plan_choice",
] as const;

export const DirectorPreferenceFeedbackSchema = z.object({
  input: DirectorInputSchema.omit({ sound_effect_catalog: true }),
  shot_index: z.number().int().nonnegative(),
  feedback_type: z.enum(DIRECTOR_PREFERENCE_TYPES),
  reason: z.string().trim().max(240).default(""),
  source: z.enum(["rule", "trae", "mira", "shared"]),
  original_shot: z.unknown(),
  final_shot: z.unknown().optional(),
});

export type DirectorPreferenceFeedback = z.infer<
  typeof DirectorPreferenceFeedbackSchema
>;

export interface DirectorPreferenceReference {
  preferenceId: string;
  feedbackType: (typeof DIRECTOR_PREFERENCE_TYPES)[number];
  reason: string;
  source: DirectorPreferenceFeedback["source"];
  narrativeFunction: string;
  roleCount: number;
  positionSource: "BP" | "自动";
  shotSummary: string;
}
