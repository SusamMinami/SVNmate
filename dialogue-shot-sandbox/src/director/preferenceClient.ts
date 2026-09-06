import type { ShotPlan } from "../types";
import type { DirectorInput, DirectorMode } from "./contracts";
import type { DirectorPreferenceFeedback } from "./preferenceContracts";

interface PreferenceEnvelope {
  ok?: boolean;
  data?: { recordId: string; updated: boolean };
  error?: { message?: string };
}

export async function recordDirectorPreference(options: {
  input: DirectorInput;
  shotIndex: number;
  feedbackType: DirectorPreferenceFeedback["feedback_type"];
  reason: string;
  source: DirectorMode | "shared";
  originalShot: ShotPlan;
  finalShot?: ShotPlan;
}): Promise<{ recordId: string; updated: boolean }> {
  const response = await fetch("/api/rule-advisor/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: options.input,
      shot_index: options.shotIndex,
      feedback_type: options.feedbackType,
      reason: options.reason,
      source: options.source,
      original_shot: options.originalShot,
      final_shot: options.finalShot,
    }),
  });
  const envelope = (await response.json()) as PreferenceEnvelope;
  if (!response.ok || !envelope.ok || !envelope.data) {
    throw new Error(envelope.error?.message || "无法同步导演偏好");
  }
  return envelope.data;
}
