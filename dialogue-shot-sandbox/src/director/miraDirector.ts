import {
  MiraDirectorResponseSchema,
  type DirectorInput,
  type DirectorProviderResult,
  type ShotDirectorProvider,
} from "./contracts";
import { resolveSoundEffectRecommendations } from "./soundEffectRecommender";

interface BridgeErrorPayload {
  code?: string;
  message?: string;
}

export class MiraDirectorError extends Error {
  constructor(
    message: string,
    readonly code = "MIRA_UNAVAILABLE",
  ) {
    super(message);
    this.name = "MiraDirectorError";
  }
}

export class MiraDirectorProvider implements ShotDirectorProvider {
  readonly id = "mira" as const;

  constructor(private readonly endpoint = "/api/director/mira") {}

  async design(input: DirectorInput): Promise<DirectorProviderResult> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
    } catch {
      throw new MiraDirectorError("无法连接本地飞书通信服务", "BRIDGE_OFFLINE");
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          data?: unknown;
          error?: BridgeErrorPayload;
        }
      | null;
    if (!response.ok || !payload?.ok) {
      throw new MiraDirectorError(
        payload?.error?.message || `Mira 请求失败（HTTP ${response.status}）`,
        payload?.error?.code,
      );
    }

    const parsed = MiraDirectorResponseSchema.safeParse(payload.data);
    if (!parsed.success) {
      throw new MiraDirectorError(
        `Mira 返回格式不符合 shot-plan.v5：${parsed.error.issues[0]?.message ?? "未知错误"}`,
        "INVALID_SCHEMA",
      );
    }
    if (parsed.data.request_id !== input.request_id) {
      throw new MiraDirectorError("Mira 回复的 request_id 不匹配", "REQUEST_MISMATCH");
    }
    if (parsed.data.status === "need_context") {
      throw new MiraDirectorError(
        `Mira 需要补充：${parsed.data.required_context.join("、")}`,
        "NEED_CONTEXT",
      );
    }

    return {
      decisions: parsed.data.shots,
      blocking: parsed.data.blocking,
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
