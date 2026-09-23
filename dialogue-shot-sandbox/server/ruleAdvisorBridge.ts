import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import { cachedAdvisorResult } from "./advisorCache";
import {
  RuleCandidateVisualAssessmentSchema,
  RuleAdvisorRequestSchema,
  RuleAdvisorResponseSchema,
  RuleBeatAdviceSchema,
  RuleBeatRequestSchema,
  RuleMusicAdviceSchema,
  RuleVisualScoreSchema,
  ExistingStoryboardReviewRequestSchema,
  type ExistingStoryboardReviewRequest,
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
import {
  ensureRuleAdvisorRuntime,
  releaseIdleRuleAdvisorResourcesNow,
  releaseRuleAdvisorResources,
  retainRuleAdvisorResources,
  ruleAdvisorKeepAlive,
} from "./ruleAdvisorRuntime";

interface AdvisorProgress {
  request_id: string;
  stage:
    | "beats"
    | "generating_candidates"
    | "scoring_candidates"
    | "complete"
    | "unavailable";
  completed: number;
  total: number;
  current_shot_index: number | null;
  current_candidate_label: string | null;
  message: string;
}

const advisorProgress = new Map<string, AdvisorProgress>();

function updateAdvisorProgress(progress: AdvisorProgress): void {
  advisorProgress.set(progress.request_id, progress);
  if (progress.stage === "complete" || progress.stage === "unavailable") {
    setTimeout(() => {
      if (advisorProgress.get(progress.request_id) === progress) {
        advisorProgress.delete(progress.request_id);
      }
    }, 60_000).unref();
  }
}

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

async function withRuleAdvisorResources<T>(
  work: () => Promise<T>,
): Promise<T> {
  const config = advisorConfig();
  if (config.apiStyle !== "ollama") {
    return work();
  }
  retainRuleAdvisorResources();
  try {
    if (!(await ensureRuleAdvisorRuntime())) {
      throw new Error("未检测到可用的 Ollama 运行时");
    }
    return await work();
  } finally {
    releaseRuleAdvisorResources();
  }
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
    if (size > 64_000_000) {
      throw new Error("请求体超过 64MB 限制");
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

export function buildVisualScorePrompt(
  request: RuleAdvisorRequest | ExistingStoryboardReviewRequest,
  frame: RuleAdvisorRequest["candidate_frames"][number],
  referenceCases: StoryboardRevisionReference[] = [],
  preferences: DirectorPreferenceReference[] = [],
): string {
  const shot = request.baseline.shots[frame.shot_index];
  const previousShot = request.baseline.shots[frame.shot_index - 1];
  const reviewExisting = "purpose" in request;
  return [
    `只评估图中的 SHOT ${String(frame.shot_index + 1).padStart(2, "0")} · ${frame.candidate_label}。`,
    "这是镜头沙盘的真实体型代理渲染，不是最终 UE 材质画面。彩色人形及其标签代表角色，白线代表 21:9 安全画幅。",
    "系统会把同一镜头的候选逐张发送给你；当前回复只评价这一张，不假设你同时看到了其他候选。",
    "所有分项必须使用 0-100 百分制，不是 0-10：优秀为 85-100，合格为 70-84，明显有问题为 40-69，不可用为 0-39。",
    "composition 评估构图稳定性；subject_readability 评估主体辨识；occlusion 越无遮挡分越高；continuity 结合上一镜语义评估连续性。overall 会由软件重算。",
    "忽略代理模型的材质简化、球形头部、身体接缝、标签样式、网格地面和缺少动画；这些不是摄影问题。只评价景别、主体位置、可见性、遮挡、留白和镜头连续性。",
    reviewExisting
      ? request.purpose === "suggest_existing"
        ? "这是已有分镜的调整候选比较。用户将自行决定是否采纳。只对当前画面评分，不输出坐标；结合原反馈判断改善程度，不因它是新候选而偏袒。issues 最多 4 项，说明尚存问题；assessment 说明具体取舍。发言角色不一定是主体，尊重反应镜头和有意留白。"
        : "这是 UE 已有分镜的只读评估。不要输出坐标或替代方案。issues 最多 4 项，每项说明可见问题及调整方向；assessment 说明优点和最值得改善的一点，不为凑数虚构问题。发言角色不一定是画面主体，反应镜头、背影和有意留白不应机械扣分。"
      : "不要提出新坐标或镜头修改，只输出评分 JSON。issues 只写可由摄影机或构图调整解决的问题，最多 4 项；assessment 用一句话说明该机位的主要取舍。",
    ...(reviewExisting ? [
      "每镜只提供起始帧，连续性分数仅结合上一镜参数和对白语义推断；没有观看上一镜图片、完整运镜、动画或真实场景，不得声称验证过这些内容。",
      "全场背景：",
      JSON.stringify({ outline: request.input.outline, dialogue: request.input.dialogue }),
      "上一镜画面参数：",
      JSON.stringify(request.purpose === "suggest_existing" ? previousShot ?? null :
        request.candidate_frames.find((candidate) => candidate.shot_index === frame.shot_index - 1)?.camera ?? null),
      "原镜头反馈（待核实，不是必须提高评分的命令）：",
      JSON.stringify(request.feedback ?? []),
    ] : []),
    "输出字段只有 composition、subject_readability、occlusion、continuity、issues、assessment。",
    "几何候选信息：",
    JSON.stringify({
      candidate_id: frame.candidate_id,
      candidate_label: frame.candidate_label,
      is_baseline: frame.is_baseline,
      legal: frame.legal,
      camera: frame.camera,
    }),
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
    "已审核返修经验（条件相符时才参考）：",
    JSON.stringify(referenceCases),
    "已确认用户偏好（accept/manual_edit 表示偏好，reject 表示应避免）：",
    JSON.stringify(preferences),
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
    "节拍不等于镜头：相邻节拍若观察对象和覆盖需求相同，可以留在同一镜头；只有观看重点、互动关系或空间需求改变才建议改变覆盖。",
    "interaction_target_slot 可选，表示 focus_slot 所看或交流的对象；反应镜头填引发反应的说话者，不按角色列表顺序选择。主体和对象必须是该节拍在场的对白角色且不能相同；不能确定就省略。",
    "强度不决定推近或压迫留白。默认静态、常规视线空间。只有明确视觉动机才填写 visual_motivation={kind,dialogue_id,evidence}：kind 为 reveal（具体信息揭示）、realization（认知转变）、isolation（孤立或抽离）、entrapment（受阻或受困）。前两者允许轻微推近，isolation 允许拉远与孤立留白，entrapment 仅允许压迫留白，不自动推近。",
    "visual_motivation 的 dialogue_id 必须位于本节拍，evidence 必须逐字引用该节点至少两个字符的原文并能支持该动机；仅有感叹号、高强度、激动或普通强调不足以填写。它不是必填字段，不为每拍凑运动。",
    "同时审阅当前对白是否存在明确的表达问题。只标注明显影响理解、上下文连续、角色口吻、信息重复、叙事节奏或因果逻辑的问题；不要把个人文风偏好当成问题。",
    "dialogue_issues 只能引用当前 dialogue 中的 id。severity=warning 表示会明显损害理解或人物逻辑，severity=note 表示值得人工复核。reason 说明问题，suggestion 只给修改方向，不直接替换或改写原台词。没有可靠问题时返回空数组。",
    "只输出 rule-beat.v1 JSON。",
    "request_id 字段填写：advisor-result",
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
  signal?: AbortSignal,
  bypassCache = false,
  validate?: (value: T) => T,
): Promise<T> {
  const config = advisorConfig();
  return cachedAdvisorResult(
    { config, prompt, schema: z.toJSONSchema(schema), imageDataUrl, maxTokens },
    () => withRuleAdvisorResources(() => {
      signal?.throwIfAborted();
      return requestStructuredUncached(prompt, schema, imageDataUrl, maxTokens, signal)
        .then((value) => validate ? validate(value) : value);
    }),
    signal,
    bypassCache,
  );
}

async function requestStructuredUncached<T>(
  prompt: string,
  schema: z.ZodType<T>,
  imageDataUrl?: string,
  maxTokens?: number,
  signal?: AbortSignal,
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
              keep_alive: ruleAdvisorKeepAlive(),
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
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
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

async function analyzeWithRuleAdvisor(request: RuleAdvisorRequest | ExistingStoryboardReviewRequest, signal?: AbortSignal) {
  const reviewExisting = "purpose" in request;
  const baselineFrames = request.candidate_frames.filter(
    (frame) => frame.is_baseline,
  );
  const technicalFailures = reviewExisting ? [] : baselineFrames.flatMap((frame) => {
    const decision = request.baseline.shots[frame.shot_index];
    return decision && frame.camera.projection_issues.length > 0
      ? [
          {
            shotIndex: frame.shot_index + 1,
            dialogueIds: decision.dialogue_ids,
            warnings: frame.camera.projection_issues,
            decision,
          },
        ]
      : [];
  });
  const [referenceCases, preferences] = reviewExisting ? [[], []] : await Promise.all([
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
  const visualScores: z.infer<typeof RuleVisualScoreSchema>[] = [];
  const total = request.candidate_frames.length;
  updateAdvisorProgress({
    request_id: request.input.request_id,
    stage: "scoring_candidates",
    completed: 0,
    total,
    current_shot_index: request.candidate_frames[0]?.shot_index ?? null,
    current_candidate_label:
      request.candidate_frames[0]?.candidate_label ?? null,
    message: `端侧模型将逐张评估 ${total} 个${reviewExisting ? "已有镜头" : "合法机位"}`,
  });

  for (const [index, frame] of request.candidate_frames.entries()) {
    signal?.throwIfAborted();
    updateAdvisorProgress({
      request_id: request.input.request_id,
      stage: "scoring_candidates",
      completed: index,
      total,
      current_shot_index: frame.shot_index,
      current_candidate_label: frame.candidate_label,
      message: `正在评估镜头 ${frame.shot_index + 1} · ${frame.candidate_label}`,
    });
    const assessment = await requestStructured(
      buildVisualScorePrompt(
        request,
        frame,
        referenceCases,
        preferences,
      ),
      RuleCandidateVisualAssessmentSchema,
      frame.image_data_url,
      256,
      signal,
      reviewExisting || ("force_regenerate" in request && request.force_regenerate === true),
    );
    visualScores.push({
      ...assessment,
      shot_index: frame.shot_index,
      candidate_id: frame.candidate_id,
      candidate_label: frame.candidate_label,
      is_baseline: frame.is_baseline,
      overall: Math.round(
        assessment.composition * 0.3 +
          assessment.subject_readability * 0.3 +
          assessment.occlusion * 0.2 +
          assessment.continuity * 0.2,
      ),
    });
  }

  const framesById = new Map(
    request.candidate_frames.map((frame) => [frame.candidate_id, frame]),
  );
  const shotIndexes = [
    ...new Set(request.candidate_frames.map((frame) => frame.shot_index)),
  ].sort((left, right) => left - right);
  const rankings = shotIndexes.map((shotIndex) => {
    const ranked = visualScores
      .filter((score) => score.shot_index === shotIndex)
      .sort(
        (left, right) =>
          right.overall - left.overall ||
          Number(right.is_baseline) - Number(left.is_baseline) ||
          left.candidate_id.localeCompare(right.candidate_id),
      );
    const legalRanked = ranked.filter(
      (score) => framesById.get(score.candidate_id)?.legal,
    );
    const selected = legalRanked[0] ?? ranked[0];
    if (!selected) {
      throw new Error(`镜头 ${shotIndex + 1} 没有可排序的机位候选`);
    }
    return {
      shot_index: shotIndex,
      selected_candidate_id: selected.candidate_id,
      ranked_candidate_ids: ranked.map((score) => score.candidate_id),
      reason: selected.assessment,
    };
  });
  const alternativeCount = rankings.filter((ranking) => {
    const selected = framesById.get(ranking.selected_candidate_id);
    return selected && !selected.is_baseline;
  }).length;
  const result = RuleAdvisorResponseSchema.parse({
    schema_version: "rule-camera-ranking.v1",
    request_id: request.input.request_id,
    model: advisorConfig().model,
    summary: reviewExisting
      ? `端侧模型已评估 ${shotIndexes.length} 个已有镜头，原配置保持不变`
      : `端侧模型逐张评估 ${shotIndexes.length} 个镜头、${visualScores.length} 个机位，并为 ${alternativeCount} 个镜头选择非基线候选`,
    visual_scores: visualScores,
    rankings,
  });
  updateAdvisorProgress({
    request_id: request.input.request_id,
    stage: "complete",
    completed: total,
    total,
    current_shot_index: null,
    current_candidate_label: null,
    message: result.summary,
  });
  return result;
}

async function analyzeRuleBeats(request: RuleBeatRequest, signal?: AbortSignal) {
  const preferences = await findRelevantDirectorPreferences(
    request.input,
    runLark,
  ).catch((error) => {
    console.error("[director-preference-library] beat lookup failed", error);
    return [];
  });
  const advice = await requestStructured(
    buildRuleBeatPrompt(request, preferences),
    RuleBeatAdviceSchema.omit({ music_cues: true }),
    undefined,
    1_536,
    signal,
    request.force_regenerate,
    (value) => validateRuleBeats(request, value),
  );
  return { ...advice, request_id: request.input.request_id, music_cues: [] };
}

function validateRuleBeats(
  request: RuleBeatRequest,
  advice: Omit<z.infer<typeof RuleBeatAdviceSchema>, "music_cues">,
) {
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
    if (beat.interaction_target_slot &&
      (!participantSlots.has(beat.interaction_target_slot) ||
        beat.interaction_target_slot === beat.focus_slot)) {
      delete beat.interaction_target_slot;
    }
    const motive = beat.visual_motivation;
    if (motive && !request.input.dialogue.slice(startIndex, endIndex + 1)
      .some((line) => line.dialogue_id === motive.dialogue_id &&
        line.content.includes(motive.evidence))) {
      delete beat.visual_motivation;
    }
    expectedStartIndex = endIndex + 1;
  }
  if (expectedStartIndex !== dialogueIds.length) {
    throw new Error("端侧顾问返回的叙事节拍未覆盖全部对白");
  }
  const seenDialogueIssues = new Set<string>();
  const dialogueIssues = advice.dialogue_issues.filter((issue) => {
    if (!indexById.has(issue.dialogue_id)) {
      throw new Error("端侧顾问返回的台词标注不在当前对白中");
    }
    const key = `${issue.dialogue_id}:${issue.category}`;
    if (seenDialogueIssues.has(key)) {
      return false;
    }
    seenDialogueIssues.add(key);
    return true;
  });
  return {
    ...advice,
    request_id: request.input.request_id,
    dialogue_issues: dialogueIssues,
    music_cues: [],
  };
}

export function buildRuleMusicPrompt(request: RuleBeatRequest): string {
  return [
    "只判断当前对白是否需要新增或切换配乐，不生成镜头、节拍或台词标注。",
    "music_catalog 已由本地规则从全库召回为少量候选，不代表必须选；在候选内结合剧情语义、recommended_use 和 semantic_profile 重排。",
    "semantic_profile 中 valence 为 -1..1 情绪倾向，arousal/tension 为 0..1，dialogue_fit 表示对白兼容度。special_use_only=true 的音乐只在剧情明确属于角色主题、PV、节庆或专属演出时使用。",
    "music_cues 是新增或切换音乐的事件，不是逐节点配乐清单。最多输出 4 个事件：开场需要音乐时输出一次，之后只在音乐确实改变的节点输出。",
    "music_cues 只能引用 music_catalog 中的 state_id 和当前 dialogue 的 dialogue_id，每个节点最多一项；同一 state_id 持续播放时绝不能在后续节点重复输出。",
    "existing_music 按对白顺序表示当前配置的切换点，音乐会持续到下一个切换点。现有配乐合适时保持，不重复推荐；除非出现明确叙事阶段改变，至少保持 3 个对白节点后再切换。",
    "优先匹配叙事功能、情绪倾向、张力走势、进入速度和对白兼容度，再参考 BPM、响度与音色。文件名和宽泛来源标签不得覆盖语义画像。",
    "没有可靠建议时返回空数组，不为普通寒暄、信息核对或缺乏明确情绪依据的段落强行配乐。",
    "只输出 request_id（填写 advisor-result）和 music_cues（dialogue_id、state_id、reason）JSON。",
    JSON.stringify({
      outline: request.input.outline,
      dialogue: request.input.dialogue,
      adjacent_context: request.input.adjacent_context,
      music_catalog: request.music_catalog,
      existing_music: request.existing_music,
    }),
  ].join("\n");
}

export function normalizeRuleMusicCues(
  request: RuleBeatRequest,
  cues: z.infer<typeof RuleMusicAdviceSchema>["music_cues"],
) {
  const indexById = new Map(
    request.input.dialogue.map((line, index) => [line.dialogue_id, index]),
  );
  const musicStateIds = new Set(
    request.music_catalog.map((item) => item.state_id),
  );
  const existingMusicByDialogueId = new Map(
    request.existing_music.map((item) => [
      item.dialogue_id,
      item.state_id,
    ]),
  );
  const cueByDialogueId = new Map<
    string,
    z.infer<typeof RuleMusicAdviceSchema>["music_cues"][number]
  >();
  for (const cue of cues) {
    if (!indexById.has(cue.dialogue_id)) {
      throw new Error("端侧顾问返回的配乐节点不在当前对白中");
    }
    if (!musicStateIds.has(cue.state_id)) {
      throw new Error("端侧顾问返回了音乐目录外的状态");
    }
    if (!cueByDialogueId.has(cue.dialogue_id)) {
      cueByDialogueId.set(cue.dialogue_id, cue);
    }
  }
  let activeStateId: number | null = null;
  const result: typeof cues = [];
  for (const line of request.input.dialogue) {
    const existingStateId = existingMusicByDialogueId.get(line.dialogue_id);
    if (existingStateId !== undefined) {
      activeStateId = existingStateId;
    }
    const cue = cueByDialogueId.get(line.dialogue_id);
    if (!cue || cue.state_id === activeStateId) {
      continue;
    }
    result.push(cue);
    activeStateId = cue.state_id;
    if (result.length >= 4) {
      break;
    }
  }
  return result;
}

async function analyzeRuleMusic(request: RuleBeatRequest, signal?: AbortSignal) {
  if (request.music_catalog.length === 0) {
    return { request_id: request.input.request_id, music_cues: [] };
  }
  const advice = await requestStructured(
    buildRuleMusicPrompt(request), RuleMusicAdviceSchema, undefined, 768,
    signal, request.force_regenerate,
    (value) => {
      const ids = new Set(request.input.dialogue.map((line) => line.dialogue_id));
      const states = new Set(request.music_catalog.map((entry) => entry.state_id));
      if (value.music_cues.some((cue) => !ids.has(cue.dialogue_id) || !states.has(cue.state_id))) {
        throw new Error("端侧配乐建议引用了对白或目录以外的条目");
      }
      return value;
    },
  );
  const musicCues = normalizeRuleMusicCues(request, advice.music_cues);
  return {
    ...advice,
    request_id: request.input.request_id,
    music_cues: musicCues,
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
  let activeRequestId: string | null = null;
  try {
    if (request.method === "GET" && url.pathname === "/api/rule-advisor/status") {
      sendJson(response, 200, { ok: true, data: await advisorStatus() });
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/rule-advisor/progress"
    ) {
      const requestId = url.searchParams.get("request_id") || "";
      sendJson(response, 200, {
        ok: true,
        data: advisorProgress.get(requestId) ?? null,
      });
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/rule-advisor/release"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: {
          released: await releaseIdleRuleAdvisorResourcesNow(),
        },
      });
      return true;
    }
    if (
      request.method === "POST" &&
      (url.pathname === "/api/rule-advisor/beats" ||
        url.pathname === "/api/rule-advisor/music")
    ) {
      const config = advisorConfig();
      if (!config.enabled) {
        sendJson(response, 200, { ok: true, data: null });
        return true;
      }
      const body = RuleBeatRequestSchema.parse(await readJson(request));
      activeRequestId = body.input.request_id;
      const controller = new AbortController();
      const abort = () => controller.abort();
      response.once("close", abort);
      try {
        const data = url.pathname.endsWith("/music")
          ? await analyzeRuleMusic(body, controller.signal)
          : await analyzeRuleBeats(body, controller.signal);
        if (!response.destroyed) sendJson(response, 200, { ok: true, data });
      } finally {
        response.off("close", abort);
      }
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
      (url.pathname === "/api/rule-advisor/analyze" ||
        url.pathname === "/api/rule-advisor/review")
    ) {
      const config = advisorConfig();
      if (!config.enabled) {
        sendJson(response, 200, { ok: true, data: null });
        return true;
      }
      const body = url.pathname === "/api/rule-advisor/review"
        ? ExistingStoryboardReviewRequestSchema.parse(await readJson(request))
        : RuleAdvisorRequestSchema.parse(await readJson(request));
      activeRequestId = body.input.request_id;
      const controller = new AbortController();
      const abort = () => controller.abort();
      response.once("close", abort);
      try {
        const data = await analyzeWithRuleAdvisor(body, controller.signal);
        if (!response.destroyed) sendJson(response, 200, { ok: true, data });
      } finally {
        response.off("close", abort);
      }
      return true;
    }
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "未知端侧顾问 API" },
    });
    return true;
  } catch (error) {
    if (activeRequestId) {
      updateAdvisorProgress({
        request_id: activeRequestId,
        stage: "unavailable",
        completed: 0,
        total: 0,
        current_shot_index: null,
        current_candidate_label: null,
        message:
          error instanceof Error ? error.message : "端侧顾问调用失败",
      });
    }
    console.warn(
      "[rule-advisor]",
      error instanceof Error ? error.message : String(error),
    );
    if (!response.destroyed) sendJson(response, 503, {
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
