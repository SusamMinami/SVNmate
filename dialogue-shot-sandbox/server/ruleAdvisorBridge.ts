import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import {
  RuleAdvisorPlanSchema,
  RuleAdvisorRequestSchema,
  RuleAdvisorResponseSchema,
  RuleBeatAdviceSchema,
  RuleBeatRequestSchema,
  RuleVisualScoreSchema,
  type RuleAdvisorRequest,
  type RuleBeatRequest,
} from "../src/director/ruleAdvisorContracts";
import type { DirectorInput } from "../src/director/contracts";
import {
  DirectorPreferenceFeedbackSchema,
  type DirectorPreferenceReference,
} from "../src/director/preferenceContracts";
import {
  findRelevantDirectorPreferences,
  saveDirectorPreference,
} from "./directorPreferenceLibrary";
import { runLark } from "./larkBridge";
import {
  findRelevantStoryboardCases,
  type StoryboardRevisionReference,
} from "./storyboardCaseLibrary";

const CompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.union([
            z.string(),
            z.array(
              z.object({
                type: z.string().optional(),
                text: z.string().optional(),
              }),
            ),
          ]),
        }),
      }),
    )
    .min(1),
});

const OllamaCompletionSchema = z.object({
  message: z.object({
    content: z.string(),
    thinking: z.string().optional(),
  }),
});

function completeAdvisorInput(
  input: Omit<DirectorInput, "sound_effect_catalog">,
): DirectorInput {
  return { ...input, sound_effect_catalog: [] };
}

function configuredPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function configuredTemperature(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function advisorConfig() {
  const apiStyle =
    process.env.RULE_ADVISOR_API_STYLE === "openai" ? "openai" : "ollama";
  return {
    enabled: process.env.RULE_ADVISOR_ENABLED !== "0",
    baseUrl: (
      process.env.RULE_ADVISOR_BASE_URL ||
      (apiStyle === "ollama"
        ? "http://127.0.0.1:11434"
        : "http://127.0.0.1:8000/v1")
    ).replace(/\/+$/, ""),
    apiStyle,
    model:
      process.env.RULE_ADVISOR_MODEL ||
      "qwen3-vl:4b",
    apiKey:
      process.env.RULE_ADVISOR_API_KEY ||
      "",
    timeoutMs: configuredPositiveNumber("RULE_ADVISOR_TIMEOUT_MS", 60_000),
    maxTokens: configuredPositiveNumber("RULE_ADVISOR_MAX_TOKENS", 1_024),
    contextTokens: configuredPositiveNumber(
      "RULE_ADVISOR_CONTEXT_TOKENS",
      8_192,
    ),
    temperature: configuredTemperature("RULE_ADVISOR_TEMPERATURE", 0.1),
    jsonMode: process.env.RULE_ADVISOR_RESPONSE_FORMAT === "json_object",
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 8_000_000) {
      throw new Error("请求体超过 8MB 限制");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function extractRuleAdvisorJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("端侧顾问回复中没有 JSON 对象");
  }
  const candidate = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(
      `端侧顾问返回了非法 JSON：${
        error instanceof Error ? error.message : "解析失败"
      }；片段：${candidate.slice(0, 500)}`,
    );
  }
}

function completionText(payload: z.infer<typeof CompletionSchema>): string {
  const content = payload.choices[0].message.content;
  return typeof content === "string"
    ? content
    : content.map((part) => part.text || "").join("");
}

export function buildRuleAdvisorPrompt(
  request: RuleAdvisorRequest,
  visualScores: z.infer<typeof RuleVisualScoreSchema>[] = [],
  referenceCases: StoryboardRevisionReference[] = [],
  preferences: DirectorPreferenceReference[] = [],
): string {
  const { input, baseline } = request;
  return [
    "你是规则导演内部的轻量镜头顾问，不是独立导演。",
    "规则系统已经生成一组合法镜头。只在有明确叙事收益时提出少量字段调整，不要重写完整方案。",
    "不得修改 dialogue_ids、角色站位、角色进出场或输出摄影机 XYZ 坐标。",
    "shot_index 从 0 开始，对应 baseline.shots 数组。最多输出 8 项调整；没有必要调整时返回空数组。",
    "每张候选画面已经由视觉评分器单独检查。根据 visual_scores 的低分项和问题提出必要调整，不要重复评分。",
    "confidence 低于 0.65 的建议不会应用。changes 只填写确实需要修改的字段。",
    "只能调整 visual_scores 中出现的 shot_index；未评分镜头保持规则基线。",
    "若改变 camera_movement，必须同步给出合法的 movement_intensity 和 end_lens_mm；焦段必须与 lens_intent 一致。",
    "优先判断叙事节拍、关系镜头延续、重要反应、景别变化、主体与构图意图。不要仅因问号、说话人切换或连续发言触发特写。",
    "体型来自 participants.body_profile；landmarkSource=proportional 表示眼睛和肩膀仍是比例估算。",
    "只输出 rule-advice.v1 JSON，不要 Markdown 或解释文字。",
    `request_id 字段填写：${input.request_id}`,
    "输出格式示例：",
    JSON.stringify({
      schema_version: "rule-advice.v1",
      request_id: input.request_id,
      summary: "对规则方案的简短判断",
      scene_analysis: {
        dramatic_goal: "本场目标",
        emotional_progression: "情绪推进",
        visual_strategy: "整体镜头策略",
      },
      adjustments: [
        {
          shot_index: 1,
          confidence: 0.82,
          reason: "该节点出现明确反应，适合收紧主体",
          changes: {
            template: "reaction_closeup",
            lens_mm: 85,
            end_lens_mm: 85,
            lens_intent: "subject_isolation",
            depth_of_field: "shallow",
          },
        },
      ],
    }),
    "场景输入：",
    JSON.stringify({
      outline: input.outline,
      participants: input.participants.map((participant) => ({
        slot: participant.slot,
        name: participant.name,
        role: participant.role,
        background: participant.background,
        position: participant.initial_position,
        facing_target: participant.initial_facing_target,
        height: participant.body_profile?.height ?? null,
      })),
      dialogue: input.dialogue.map((line) => ({
        id: line.dialogue_id,
        speaker_slot: line.speaker,
        text: line.content,
      })),
      adjacent_context: input.adjacent_context,
      constraints: {
        primary_aspect_ratio: input.constraints.primary_aspect_ratio,
        overlay_aspect_ratio: input.constraints.overlay_aspect_ratio,
        avoid_character_overlap: input.constraints.avoid_character_overlap,
      },
    }),
    "规则导演基线：",
    JSON.stringify({
      analysis: baseline.analysis,
      shots: baseline.shots.map((shot) => ({
        dialogue_ids: shot.dialogue_ids,
        template: shot.template,
        subject: shot.subject,
        look_target: shot.look_target,
        lens_mm: shot.lens_mm,
        end_lens_mm: shot.end_lens_mm,
        lens_intent: shot.lens_intent,
        depth_of_field: shot.depth_of_field,
        camera_movement: shot.camera_movement,
        movement_intensity: shot.movement_intensity,
        composition_mode: shot.composition_mode,
        visual_anchor: shot.visual_anchor,
        negative_space: shot.negative_space,
        coverage_intent: shot.coverage_intent,
        camera_height: shot.camera_height,
      })),
    }),
    "逐镜视觉评分：",
    JSON.stringify(visualScores),
    "已审核返修经验（仅在问题和条件相符时参考）：",
    JSON.stringify(referenceCases),
    "已确认用户偏好（accept/manual_edit 表示偏好，reject 表示应避免；条件不同不可照搬）：",
    JSON.stringify(preferences),
  ].join("\n");
}

function buildVisualScorePrompt(
  request: RuleAdvisorRequest,
  frame: RuleAdvisorRequest["candidate_frames"][number],
): string {
  const shot = request.baseline.shots[frame.shot_index];
  const previousShot = request.baseline.shots[frame.shot_index - 1];
  return [
    `只评估图中的 SHOT ${String(frame.shot_index + 1).padStart(2, "0")}。`,
    "这是镜头沙盘的真实体型代理渲染，不是最终 UE 材质画面。彩色人形及其标签代表角色，白线代表 21:9 安全画幅。",
    "所有分项必须使用 0-100 百分制，不是 0-10：优秀为 85-100，合格为 70-84，明显有问题为 40-69，不可用为 0-39。",
    "composition 评估构图稳定性；subject_readability 评估主体辨识；occlusion 越无遮挡分越高；continuity 结合上一镜语义评估连续性。overall 会由软件重算。",
    "忽略代理模型的材质简化、球形头部、身体接缝、标签样式、网格地面和缺少动画；这些不是摄影问题。只评价景别、主体位置、可见性、遮挡、留白和镜头连续性。",
    "不要提出镜头修改，只输出评分 JSON。issues 只写可由摄影机或构图调整解决的问题，最多 4 项。",
    `shot_index 必须填写 ${frame.shot_index}。`,
    "当前镜头语义：",
    JSON.stringify(shot),
    "上一镜语义：",
    JSON.stringify(previousShot ?? null),
    "当前对白：",
    JSON.stringify(
      request.input.dialogue.filter((line) =>
        frame.dialogue_ids.includes(line.dialogue_id),
      ),
    ),
  ].join("\n");
}

export function buildRuleBeatPrompt(
  request: RuleBeatRequest,
  preferences: DirectorPreferenceReference[] = [],
): string {
  const { input } = request;
  return [
    "你是规则导演的叙事节拍分析器，不负责生成摄影机参数。",
    "将整段对白划分为少量连续节拍，并为每个节拍建议覆盖策略。所有对白必须按原顺序恰好覆盖一次，节拍之间不能重叠或留空。",
    "不要因为说话人切换或问号机械切镜。优先识别关系建立、信息发展、压力升级、揭示、无言反应、过渡和释放。",
    "intensity 使用 0-100：平静铺垫 15-35，普通发展 35-55，明确转折 55-75，高潮或强烈反应 75-100。",
    "relationship_hold 表示维持双人或群像；speaker_focus 表示普通主体镜头；reaction_focus 只用于明确反应；emphasis_focus 只用于关键揭示或压力峰值；reestablish 用于角色进出场或空间关系改变。",
    "通常输出 2-6 个节拍。focus_slot 仅在需要强调明确角色时填写。",
    "只输出 rule-beat.v1 JSON。",
    `request_id 字段填写：${input.request_id}`,
    "场景：",
    JSON.stringify({
      outline: input.outline,
      participants: input.participants.map((participant) => ({
        slot: participant.slot,
        name: participant.name,
        role: participant.role,
        background: participant.background,
        entry_dialogue_id: participant.entry_dialogue_id,
        exit_dialogue_id: participant.exit_dialogue_id,
      })),
      dialogue: input.dialogue.map((line) => ({
        id: line.dialogue_id,
        speaker: line.speaker,
        content: line.content,
      })),
      adjacent_context: input.adjacent_context,
    }),
    "已确认用户偏好（只影响节拍与覆盖倾向，不能覆盖硬规则）：",
    JSON.stringify(preferences),
  ].join("\n");
}

async function requestStructured<T>(
  prompt: string,
  schema: z.ZodType<T>,
  imageDataUrl?: string,
  maxTokens?: number,
): Promise<T> {
  const config = advisorConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const ollamaBaseUrl = config.baseUrl.replace(/\/v1$/, "");
    const response = await fetch(
      config.apiStyle === "ollama"
        ? `${ollamaBaseUrl}/api/chat`
        : `${config.baseUrl}/chat/completions`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(config.apiKey),
      },
      body: JSON.stringify(
        config.apiStyle === "ollama"
          ? {
              model: config.model,
              messages: [
                {
                  role: "user",
                  content: prompt,
                  ...(imageDataUrl
                    ? {
                        images: [
                          imageDataUrl.replace(
                      /^data:image\/(?:jpeg|png);base64,/,
                      "",
                    ),
                        ],
                      }
                    : {}),
                },
              ],
              stream: false,
              think: false,
              format: z.toJSONSchema(schema),
              options: {
                temperature: config.temperature,
                num_ctx: config.contextTokens,
                num_predict: maxTokens ?? config.maxTokens,
              },
            }
          : {
              model: config.model,
              messages: [
                {
                  role: "user",
                  content: imageDataUrl
                    ? [
                        { type: "text", text: prompt },
                        {
                          type: "image_url",
                          image_url: { url: imageDataUrl },
                        },
                      ]
                    : prompt,
                },
              ],
              temperature: config.temperature,
              max_tokens: maxTokens ?? config.maxTokens,
              ...(config.jsonMode
                ? { response_format: { type: "json_object" } }
                : {}),
            },
      ),
      signal: controller.signal,
      },
    );
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `端侧顾问返回 HTTP ${response.status}：${body.slice(0, 500)}`,
      );
    }
    const parsedBody = JSON.parse(body);
    const content = (() => {
      if (config.apiStyle !== "ollama") {
        return completionText(CompletionSchema.parse(parsedBody));
      }
      const message = OllamaCompletionSchema.parse(parsedBody).message;
      return message.content.trim() || message.thinking?.trim() || "";
    })();
    return schema.parse(extractRuleAdvisorJson(content));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`端侧顾问推理超时（${config.timeoutMs / 1000} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeWithRuleAdvisor(request: RuleAdvisorRequest) {
  const visualScores: z.infer<typeof RuleVisualScoreSchema>[] = [];
  for (const frame of request.candidate_frames) {
    const score = await requestStructured(
      buildVisualScorePrompt(request, frame),
      RuleVisualScoreSchema,
      frame.image_data_url,
      256,
    );
    visualScores.push({
      ...score,
      shot_index: frame.shot_index,
      overall: Math.round(
        score.composition * 0.3 +
          score.subject_readability * 0.3 +
          score.occlusion * 0.2 +
          score.continuity * 0.2,
      ),
    });
  }
  const technicalFailures = visualScores
    .filter((score) => score.issues.length > 0 || score.overall < 75)
    .flatMap((score) => {
      const decision = request.baseline.shots[score.shot_index];
      return decision
        ? [
            {
              shotIndex: score.shot_index + 1,
              dialogueIds: decision.dialogue_ids,
              warnings: score.issues,
              decision,
            },
          ]
        : [];
    });
  const [referenceCases, preferences] = await Promise.all([
    findRelevantStoryboardCases(
      completeAdvisorInput(request.input),
      technicalFailures,
      runLark,
    ).catch((error) => {
      console.error("[storyboard-case-library] advisor lookup failed", error);
      return [];
    }),
    findRelevantDirectorPreferences(request.input, runLark).catch((error) => {
      console.error("[director-preference-library] lookup failed", error);
      return [];
    }),
  ]);
  const plan = await requestStructured(
    buildRuleAdvisorPrompt(
      request,
      visualScores,
      referenceCases,
      preferences,
    ),
    RuleAdvisorPlanSchema,
  );
  return RuleAdvisorResponseSchema.parse({
    ...plan,
    request_id: request.input.request_id,
    visual_scores: visualScores,
  });
}

async function analyzeRuleBeats(request: RuleBeatRequest) {
  const preferences = await findRelevantDirectorPreferences(
    request.input,
    runLark,
  ).catch((error) => {
    console.error("[director-preference-library] beat lookup failed", error);
    return [];
  });
  const advice = await requestStructured(
    buildRuleBeatPrompt(request, preferences),
    RuleBeatAdviceSchema,
    undefined,
    1_024,
  );
  const dialogueIds = request.input.dialogue.map((line) => line.dialogue_id);
  const indexById = new Map(dialogueIds.map((id, index) => [id, index]));
  const participantSlots = new Set(
    request.input.participants.map((participant) => participant.slot),
  );
  let expectedStartIndex = 0;
  for (const beat of advice.beats) {
    const startIndex = indexById.get(beat.start_dialogue_id);
    const endIndex = indexById.get(beat.end_dialogue_id);
    if (
      startIndex !== expectedStartIndex ||
      endIndex === undefined ||
      endIndex < startIndex
    ) {
      throw new Error("端侧顾问返回的叙事节拍未连续覆盖对白");
    }
    if (beat.focus_slot && !participantSlots.has(beat.focus_slot)) {
      throw new Error("端侧顾问返回的节拍主体不在当前角色列表中");
    }
    expectedStartIndex = endIndex + 1;
  }
  if (expectedStartIndex !== dialogueIds.length) {
    throw new Error("端侧顾问返回的叙事节拍未覆盖全部对白");
  }
  return {
    ...advice,
    request_id: request.input.request_id,
  };
}

async function advisorStatus() {
  const config = advisorConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      connected: false,
      baseUrl: config.baseUrl,
      model: config.model,
      apiStyle: config.apiStyle,
      detail: "端侧顾问已禁用",
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const ollamaBaseUrl = config.baseUrl.replace(/\/v1$/, "");
    const response = await fetch(
      config.apiStyle === "ollama"
        ? `${ollamaBaseUrl}/api/tags`
        : `${config.baseUrl}/models`,
      {
      headers: authHeaders(config.apiKey),
      signal: controller.signal,
      },
    );
    const payload = response.ok
      ? await response.json().catch(() => null)
      : null;
    const availableModels =
      config.apiStyle === "ollama"
        ? ((payload as { models?: Array<{ name?: string; model?: string }> } | null)
            ?.models ?? []).flatMap((item) => [item.name, item.model])
        : ((payload as { data?: Array<{ id?: string }> } | null)?.data ?? [])
            .map((item) => item.id);
    const modelAvailable = availableModels.includes(config.model);
    return {
      enabled: true,
      connected: response.ok && modelAvailable,
      baseUrl: config.baseUrl,
      model: config.model,
      apiStyle: config.apiStyle,
      detail: !response.ok
        ? `HTTP ${response.status}`
        : modelAvailable
          ? "端侧顾问可用"
          : "推理服务已连接，但模型尚未安装",
    };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      baseUrl: config.baseUrl,
      model: config.model,
      apiStyle: config.apiStyle,
      detail:
        error instanceof Error ? error.message : "无法连接端侧顾问",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function routeRuleAdvisorRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const url = new URL(request.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/rule-advisor")) {
    return false;
  }
  try {
    if (request.method === "GET" && url.pathname === "/api/rule-advisor/status") {
      sendJson(response, 200, { ok: true, data: await advisorStatus() });
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/rule-advisor/beats"
    ) {
      const config = advisorConfig();
      if (!config.enabled) {
        sendJson(response, 200, { ok: true, data: null });
        return true;
      }
      const body = RuleBeatRequestSchema.parse(await readJson(request));
      sendJson(response, 200, {
        ok: true,
        data: await analyzeRuleBeats(body),
      });
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/rule-advisor/preferences"
    ) {
      const feedback = DirectorPreferenceFeedbackSchema.parse(
        await readJson(request),
      );
      sendJson(response, 200, {
        ok: true,
        data: await saveDirectorPreference(feedback, runLark),
      });
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/rule-advisor/analyze"
    ) {
      const config = advisorConfig();
      if (!config.enabled) {
        sendJson(response, 200, { ok: true, data: null });
        return true;
      }
      const body = RuleAdvisorRequestSchema.parse(await readJson(request));
      sendJson(response, 200, {
        ok: true,
        data: await analyzeWithRuleAdvisor(body),
      });
      return true;
    }
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "未知端侧顾问 API" },
    });
    return true;
  } catch (error) {
    console.warn(
      "[rule-advisor]",
      error instanceof Error ? error.message : String(error),
    );
    sendJson(response, 503, {
      ok: false,
      error: {
        code: "RULE_ADVISOR_ERROR",
        message:
          error instanceof Error ? error.message : "端侧顾问调用失败",
      },
    });
    return true;
  }
}

function installMiddleware(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use(async (request, response, next) => {
    if (!(await routeRuleAdvisorRequest(request, response))) {
      next();
    }
  });
}

export function ruleAdvisorBridgePlugin(): Plugin {
  return {
    name: "rule-advisor-bridge",
    configureServer(server) {
      installMiddleware(server);
    },
    configurePreviewServer(server) {
      installMiddleware(server);
    },
  };
}
