import {
  DirectorInputSchema,
  MiraDirectorResponseSchema,
  type DirectorInput,
  type DirectorProviderResult,
  type ShotDirectorProvider,
} from "./contracts";
import { resolveSoundEffectRecommendations } from "./soundEffectRecommender";

interface BridgeEnvelope {
  ok?: boolean;
  data?: unknown;
  meta?: {
    source?: "generated" | "local-cache" | "shared-library";
    shared_conflict?: {
      record_id?: string;
      input?: unknown;
      plan?: unknown;
    } | null;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export class TraeDirectorProvider implements ShotDirectorProvider {
  readonly id = "trae" as const;

  constructor(private readonly endpoint = "/api/director/trae") {}

  async design(
    input: DirectorInput,
    options: { forceRegenerate?: boolean } = {},
  ): Promise<DirectorProviderResult> {
    let response: Response;
    try {
      response = await fetch(
        `${this.endpoint}${options.forceRegenerate ? "?force=1" : ""}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        },
      );
    } catch {
      throw new Error("无法连接内部 TRAE 协作服务");
    }

    const payload = (await response.json().catch(() => null)) as
      | BridgeEnvelope
      | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(
        payload?.error?.message ||
          `内部 TRAE 协作请求失败（HTTP ${response.status}）`,
      );
    }
    const parsed = MiraDirectorResponseSchema.safeParse(payload.data);
    if (!parsed.success) {
      throw new Error(
        `内部 TRAE 返回格式不符合 shot-plan.v5：${parsed.error.issues[0]?.message ?? "未知错误"}`,
      );
    }
    if (parsed.data.request_id !== input.request_id) {
      throw new Error("内部 TRAE 回复的 request_id 不匹配");
    }
    if (parsed.data.status === "need_context") {
      throw new Error(
        `内部 TRAE 需要补充：${parsed.data.required_context.join("、")}`,
      );
    }
    const conflictInput = DirectorInputSchema.safeParse(
      payload.meta?.shared_conflict?.input,
    );
    const conflictPlan = MiraDirectorResponseSchema.safeParse(
      payload.meta?.shared_conflict?.plan,
    );
    const sharedConflict =
      payload.meta?.shared_conflict?.record_id &&
      conflictInput.success &&
      conflictPlan.success &&
      conflictPlan.data.status === "ready"
        ? {
            recordId: payload.meta.shared_conflict.record_id,
            input: conflictInput.data,
            plan: conflictPlan.data,
          }
        : undefined;
    return {
      decisions: parsed.data.shots,
      blocking: parsed.data.blocking,
      rawPlan: parsed.data,
      sharedSource: payload.meta?.source,
      sharedConflict,
      analysis: {
        dramaticGoal: parsed.data.scene_analysis.dramatic_goal,
        emotionalProgression:
          parsed.data.scene_analysis.emotional_progression,
        visualStrategy: parsed.data.scene_analysis.visual_strategy,
      },
      soundEffects: resolveSoundEffectRecommendations(
        input,
        parsed.data.sound_effects,
      ),
    };
  }
}
