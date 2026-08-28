import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import { SOUND_EFFECT_CATALOG_SOURCE } from "../src/data/soundEffectCatalog";
import {
  MUSIC_ANALYSIS_TABLE_ID,
  MUSIC_BASE_TOKEN,
  MUSIC_TABLE_ID,
} from "../src/data/musicCatalog";
import {
  DirectorInputSchema,
  MiraDirectorResponseSchema,
  type DirectorInput,
  type MiraDirectorResponse,
} from "../src/director/contracts";
import { inspectDirectorProjection } from "../src/director/orchestrator";
import { buildDirectorPrompt } from "../src/director/prompt";
import {
  findRelevantStoryboardCases,
  saveStoryboardRevisionCases,
} from "./storyboardCaseLibrary";
import {
  loadSoundEffectCatalog,
  syncSoundEffectCatalog,
} from "./soundEffectCatalogStore";
import { refreshSoundEffectLibrary } from "./soundEffectLibraryStore";
import { streamAudioFile } from "./audioStream";
import {
  ensureMusicDirectories,
  loadMusicCatalog,
  musicAnalysisRecordPath,
  musicAttachmentPath,
  musicCatalogRecordPath,
} from "./musicCatalogStore";

const execFileAsync = promisify(execFile);

function miraIdempotencyKey(requestId: string, phase: "initial" | "revision") {
  return createHash("sha256")
    .update(`${phase}:${requestId}`)
    .digest("hex")
    .slice(0, 50);
}
const MIRA_REQUIRED_SCOPES = [
  "search:bot",
  "im:message.send_as_user",
] as const;
const BASE_REQUIRED_SCOPES = [
  "base:app:read",
  "base:table:read",
  "base:field:read",
  "base:record:read",
  "base:record:create",
  "base:record:update",
] as const;
const DOC_REQUIRED_SCOPES = [
  "docs:document.content:read",
  "docx:document:readonly",
] as const;
const REQUIRED_SCOPES = [
  ...MIRA_REQUIRED_SCOPES,
  ...BASE_REQUIRED_SCOPES,
  ...DOC_REQUIRED_SCOPES,
] as const;
const MIRA_QUERY = process.env.MIRA_BOT_QUERY || "Mira";
const COMMAND_TIMEOUT_MS = 30_000;
const MIRA_REPLY_TIMEOUT_MS = 55_000;
const AUTH_FALLBACK_TTL_MS = 5 * 60_000;

interface LarkCommandError {
  type?: string;
  subtype?: string;
  message?: string;
  hint?: string;
  missing_scopes?: string[];
}

interface LarkCommandEnvelope {
  ok?: boolean;
  data?: unknown;
  error?: LarkCommandError;
  [key: string]: unknown;
}

interface MiraBot {
  openId: string;
  name: string;
  description: string;
  chatId: string;
}

interface PendingAuth {
  deviceCode: string;
  verificationUrl: string;
  qrDataUrl: string;
  scopes: string[];
  expiresAt: number;
}

interface AuthStatusSnapshot {
  cliAvailable: true;
  authorized: boolean;
  identity: string;
  userName: string;
  openId: string;
  userStatus: string;
  missingScopes: string[];
  miraMissingScopes: string[];
  baseMissingScopes: string[];
  docsMissingScopes: string[];
  caseLibraryReady: boolean;
  soundEffectCatalogReady: boolean;
  miraBot: MiraBot | null;
}

const state: {
  pendingAuth: PendingAuth | null;
  authCompletion: Promise<AuthStatusSnapshot> | null;
  miraBot: MiraBot | null;
  activeMiraRequest: string | null;
} = {
  pendingAuth: null,
  authCompletion: null,
  miraBot: null,
  activeMiraRequest: null,
};

function larkCliEntry(): string {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error("当前环境缺少 APPDATA，无法定位 lark-cli");
  }
  return join(
    appData,
    "npm",
    "node_modules",
    "@larksuite",
    "cli",
    "scripts",
    "run.js",
  );
}

function larkEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
  };
}

function parseJsonOutput(text: string): LarkCommandEnvelope {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed) as LarkCommandEnvelope;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as LarkCommandEnvelope;
    }
    throw new Error("lark-cli 返回了无法解析的内容");
  }
}

export async function runLark(
  args: string[],
  timeout = COMMAND_TIMEOUT_MS,
  cwd = process.cwd(),
): Promise<LarkCommandEnvelope> {
  try {
    const result = await execFileAsync(process.execPath, [larkCliEntry(), ...args], {
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      cwd,
      env: larkEnvironment(),
    });
    return parseJsonOutput(result.stdout);
  } catch (error) {
    const commandError = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    const output = commandError.stdout || commandError.stderr || "";
    if (output.trim()) {
      return parseJsonOutput(output);
    }
    if (commandError.killed) {
      throw new Error("lark-cli 调用超时");
    }
    throw new Error(`无法执行 lark-cli（${String(commandError.code ?? "unknown")}）`);
  }
}

async function generateQrDataUrl(verificationUrl: string): Promise<string> {
  const directory = ".lark-auth";
  const relativePath = `${directory}/auth-${randomUUID()}.png`;
  const absolutePath = join(process.cwd(), relativePath);
  await mkdir(join(process.cwd(), directory), { recursive: true });
  try {
    await execFileAsync(
      process.execPath,
      [
        larkCliEntry(),
        "auth",
        "qrcode",
        verificationUrl,
        "--output",
        relativePath,
        "--size",
        "260",
      ],
      {
        windowsHide: true,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        cwd: process.cwd(),
        env: larkEnvironment(),
      },
    );
    return `data:image/png;base64,${(await readFile(absolutePath)).toString("base64")}`;
  } finally {
    await rm(absolutePath, { force: true }).catch(() => undefined);
  }
}

export function unwrapData<T>(envelope: LarkCommandEnvelope): T {
  if (envelope.ok === false || envelope.error) {
    const error = new Error(
      envelope.error?.message || "飞书请求失败",
    ) as Error & { code?: string; missingScopes?: string[]; hint?: string };
    error.code = envelope.error?.subtype || envelope.error?.type;
    error.missingScopes = envelope.error?.missing_scopes;
    error.hint = envelope.error?.hint;
    throw error;
  }
  return ((envelope.data ?? envelope) as unknown) as T;
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
    if (size > 1_000_000) {
      throw new Error("请求体超过 1MB 限制");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function normalizeError(error: unknown) {
  const typed = error as Error & {
    code?: string;
    missingScopes?: string[];
    hint?: string;
  };
  const missingScopes = typed.missingScopes ?? [];
  const deviceCodeExpired = /device_code is invalid/i.test(typed.message || "");
  const code = deviceCodeExpired
    ? "AUTH_CODE_EXPIRED"
    : typed.code || "LARK_BRIDGE_ERROR";
  return {
    code,
    message:
      deviceCodeExpired
        ? "本次授权码已失效，请使用新生成的二维码重新授权"
        : code === "missing_scope" && missingScopes.length > 0
        ? `飞书缺少权限：${missingScopes.join("、")}`
        : typed.message || "飞书通信失败",
    missing_scopes: missingScopes,
    hint: typed.hint,
  };
}

async function authStatus(): Promise<AuthStatusSnapshot> {
  const envelope = await runLark(["auth", "status", "--json", "--verify"]);
  const data = unwrapData<{
    identity?: string;
    verified?: boolean;
    identities?: {
      user?: {
        status?: string;
        verified?: boolean;
        userName?: string;
        openId?: string;
        scope?: string;
      };
    };
  }>(envelope);
  const user = data.identities?.user;
  const scopeStatus = classifyLarkScopes(user?.scope || "");
  return {
    cliAvailable: true as const,
    authorized: Boolean(data.verified && user?.verified),
    identity: data.identity || "unknown",
    userName: user?.userName || "",
    openId: user?.openId || "",
    userStatus: user?.status || "unknown",
    missingScopes: scopeStatus.missingScopes,
    miraMissingScopes: scopeStatus.miraMissingScopes,
    baseMissingScopes: scopeStatus.baseMissingScopes,
    docsMissingScopes: scopeStatus.docsMissingScopes,
    caseLibraryReady:
      Boolean(data.verified && user?.verified) &&
      scopeStatus.baseMissingScopes.length === 0,
    soundEffectCatalogReady:
      Boolean(data.verified && user?.verified) &&
      scopeStatus.docsMissingScopes.length === 0,
    miraBot: state.miraBot,
  };
}

export function classifyLarkScopes(scopeText: string): {
  missingScopes: string[];
  miraMissingScopes: string[];
  baseMissingScopes: string[];
  docsMissingScopes: string[];
} {
  const scopes = new Set(scopeText.split(/\s+/).filter(Boolean));
  const miraMissingScopes = MIRA_REQUIRED_SCOPES.filter(
    (scope) => !scopes.has(scope),
  );
  const baseMissingScopes = BASE_REQUIRED_SCOPES.filter(
    (scope) => !scopes.has(scope),
  );
  const docsMissingScopes = DOC_REQUIRED_SCOPES.filter(
    (scope) => !scopes.has(scope),
  );
  return {
    missingScopes: REQUIRED_SCOPES.filter((scope) => !scopes.has(scope)),
    miraMissingScopes: [...miraMissingScopes],
    baseMissingScopes: [...baseMissingScopes],
    docsMissingScopes: [...docsMissingScopes],
  };
}

async function fetchSoundEffectDocument(): Promise<{
  content: string;
  revisionId: number;
}> {
  const envelope = await runLark(
    [
      "docs",
      "+fetch",
      "--doc",
      SOUND_EFFECT_CATALOG_SOURCE,
      "--doc-format",
      "markdown",
      "--as",
      "user",
      "--format",
      "json",
    ],
    60_000,
  );
  const data = unwrapData<{
    document?: {
      content?: string;
      revision_id?: number;
    };
  }>(envelope);
  if (!data.document?.content) {
    throw new Error("飞书文档没有返回音效目录内容");
  }
  return {
    content: data.document.content,
    revisionId: Number(data.document.revision_id ?? 0),
  };
}

function normalizeBots(payload: unknown): MiraBot[] {
  const root = payload as {
    bots?: unknown[];
  };
  return (root.bots ?? []).flatMap((raw) => {
    const bot = raw as {
      open_id?: string;
      name?: string;
      description?: string;
      chat_id?: string;
    };
    if (!bot.open_id) {
      return [];
    }
    return [
      {
        openId: bot.open_id,
        name: bot.name || bot.open_id,
        description: bot.description || "",
        chatId: bot.chat_id || "",
      },
    ];
  });
}

async function discoverMira(): Promise<{
  selected: MiraBot | null;
  candidates: MiraBot[];
}> {
  const configuredId = process.env.MIRA_BOT_OPEN_ID;
  if (configuredId) {
    state.miraBot = {
      openId: configuredId,
      name: process.env.MIRA_BOT_NAME || "Mira",
      description: "由 MIRA_BOT_OPEN_ID 配置",
      chatId: process.env.MIRA_CHAT_ID || "",
    };
    return { selected: state.miraBot, candidates: [state.miraBot] };
  }
  const envelope = await runLark([
    "contact",
    "+search-bot",
    "--query",
    MIRA_QUERY,
    "--as",
    "user",
    "--format",
    "json",
  ]);
  const candidates = normalizeBots(unwrapData<unknown>(envelope));
  const exact = candidates.filter(
    (candidate) => candidate.name.localeCompare(MIRA_QUERY, undefined, {
      sensitivity: "accent",
    }) === 0,
  );
  const selected =
    exact.length === 1
      ? exact[0]
      : candidates.length === 1
        ? candidates[0]
        : null;
  state.miraBot = selected;
  return { selected, candidates };
}

function messageArray(payload: unknown): Array<Record<string, unknown>> {
  const root = payload as { messages?: Array<Record<string, unknown>> };
  return root.messages ?? [];
}

function messageContent(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content ?? "");
}

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("Mira 回复中没有 JSON 对象");
  }
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function waitForMiraReply(
  bot: MiraBot,
  input: DirectorInput,
  startIso: string,
): Promise<MiraDirectorResponse> {
  const deadline = Date.now() + MIRA_REPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const envelope = await runLark([
      "im",
      "+chat-messages-list",
      "--user-id",
      bot.openId,
      "--start",
      startIso,
      "--order",
      "desc",
      "--page-size",
      "20",
      "--no-reactions",
      "--as",
      "user",
      "--format",
      "json",
    ]);
    const messages = messageArray(unwrapData<unknown>(envelope));
    for (const message of messages) {
      const sender = message.sender as
        | { id?: string; open_id?: string; name?: string }
        | undefined;
      const isMira =
        sender?.id === bot.openId ||
        sender?.open_id === bot.openId ||
        sender?.name === bot.name;
      if (!isMira) {
        continue;
      }
      const content = messageContent(message);
      if (!content.includes(input.request_id)) {
        continue;
      }
      const parsed = extractJsonObject(content);
      return MiraDirectorResponseSchema.parse(parsed);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const timeoutError = new Error(
    `等待 Mira 回复超时（${MIRA_REPLY_TIMEOUT_MS / 1000} 秒）`,
  ) as Error & { code?: string };
  timeoutError.code = "MIRA_TIMEOUT";
  throw timeoutError;
}

async function analyzeWithMira(input: DirectorInput): Promise<unknown> {
  if (state.activeMiraRequest) {
    const busyError = new Error("已有 Mira 分析任务正在进行") as Error & {
      code?: string;
    };
    busyError.code = "MIRA_BUSY";
    throw busyError;
  }
  state.activeMiraRequest = input.request_id;
  try {
    const discovery = state.miraBot
      ? { selected: state.miraBot, candidates: [state.miraBot] }
      : await discoverMira();
    if (!discovery.selected) {
      const error = new Error(
        discovery.candidates.length === 0
          ? "没有找到可见的 Mira 机器人"
          : `找到多个 Mira 候选：${discovery.candidates.map((item) => item.name).join("、")}`,
      ) as Error & { code?: string };
      error.code =
        discovery.candidates.length === 0 ? "MIRA_NOT_FOUND" : "MIRA_AMBIGUOUS";
      throw error;
    }

    const prompt = buildDirectorPrompt(input, "Mira AI 导演");
    const startIso = new Date(Date.now() - 5_000).toISOString();
    unwrapData(
      await runLark([
        "im",
        "+messages-send",
        "--user-id",
        discovery.selected.openId,
        "--text",
        prompt,
        "--idempotency-key",
        miraIdempotencyKey(input.request_id, "initial"),
        "--as",
        "user",
        "--format",
        "json",
      ]),
    );
    const firstResult = await waitForMiraReply(
      discovery.selected,
      input,
      startIso,
    );
    if (firstResult.status !== "ready") {
      return firstResult;
    }

    const projectionFailures = inspectDirectorProjection(input, firstResult);
    if (projectionFailures.length === 0) {
      return firstResult;
    }

    const revisionInput = {
      ...input,
      request_id: `${input.request_id.slice(0, 80)}-projection-retry`,
    };
    const referenceCases = await findRelevantStoryboardCases(
      input,
      projectionFailures,
      runLark,
    ).catch((error) => {
      console.error("[storyboard-case-library] lookup failed", error);
      return [];
    });
    const revisionPrompt = buildDirectorPrompt(
      revisionInput,
      "Mira AI 导演",
      {
        previousPlan: firstResult,
        failures: projectionFailures,
        referenceCases,
      },
    );
    const revisionStartIso = new Date(Date.now() - 5_000).toISOString();
    unwrapData(
      await runLark([
        "im",
        "+messages-send",
        "--user-id",
        discovery.selected.openId,
        "--text",
        revisionPrompt,
        "--idempotency-key",
        miraIdempotencyKey(input.request_id, "revision"),
        "--as",
        "user",
        "--format",
        "json",
      ]),
    );
    const revisedResult = await waitForMiraReply(
      discovery.selected,
      revisionInput,
      revisionStartIso,
    );
    if (revisedResult.status !== "ready") {
      return firstResult;
    }
    const failedShotIndexes = new Set(
      projectionFailures.map((failure) => failure.shotIndex - 1),
    );
    const mergedResult: MiraDirectorResponse = {
      ...firstResult,
      request_id: input.request_id,
      shots: firstResult.shots.map((shot, index) =>
        failedShotIndexes.has(index)
          ? (revisedResult.shots[index] ?? shot)
          : shot,
      ),
      revision_reflections: revisedResult.revision_reflections,
    };
    let revisedFailures: ReturnType<typeof inspectDirectorProjection>;
    try {
      revisedFailures = inspectDirectorProjection(input, mergedResult);
    } catch {
      return firstResult;
    }
    if (input.constraints.collect_revision_cases !== false) {
      await saveStoryboardRevisionCases(
        input,
        firstResult,
        mergedResult,
        projectionFailures,
        revisedFailures,
        "Mira AI",
        referenceCases,
        runLark,
      ).catch((error) => {
        console.error("[storyboard-case-library] upload failed", error);
      });
    }
    const failureScore = (
      failures: ReturnType<typeof inspectDirectorProjection>,
    ) =>
      failures.reduce(
        (score, failure) => score + 1_000 + failure.warnings.length,
        0,
      );
    const selectedResult =
      failureScore(revisedFailures) < failureScore(projectionFailures)
        ? mergedResult
        : firstResult;
    return {
      ...selectedResult,
      request_id: input.request_id,
    };
  } finally {
    state.activeMiraRequest = null;
  }
}

export async function routeLarkRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const url = new URL(request.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/")) {
    return false;
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/lark/status") {
      sendJson(response, 200, { ok: true, data: await authStatus() });
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/lark/sound-effects/catalog"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: await loadSoundEffectCatalog(),
      });
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/lark/sound-effects/sync"
    ) {
      const catalog = await syncSoundEffectCatalog(fetchSoundEffectDocument);
      await refreshSoundEffectLibrary().catch((error) => {
        console.error("[sound-effect-library] remote cache sync failed", error);
      });
      sendJson(response, 200, {
        ok: true,
        data: catalog,
      });
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/lark/music/catalog"
    ) {
      sendJson(response, 200, { ok: true, data: await loadMusicCatalog() });
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/lark/music/sync"
    ) {
      await ensureMusicDirectories();
      const recordPath = musicCatalogRecordPath();
      const analysisPath = musicAnalysisRecordPath();
      const projectRoot = dirname(dirname(recordPath));
      const relativeRecordPath = `./${relative(projectRoot, recordPath).replaceAll("\\", "/")}`;
      const relativeAnalysisPath =
        `./${relative(projectRoot, analysisPath).replaceAll("\\", "/")}`;
      const result = unwrapData<Record<string, unknown>>(
        await runLark(
          [
            "base",
            "+record-list",
            "--base-token",
            MUSIC_BASE_TOKEN,
            "--table-id",
            MUSIC_TABLE_ID,
            "--format",
            "ndjson",
            "--output",
            relativeRecordPath,
            "--overwrite",
            "--as",
            "user",
          ],
          120_000,
          projectRoot,
        ),
      );
      if (result.has_more === true) {
        throw new Error("音乐资料库超过 2000 条，请缩小同步范围");
      }
      const analysisResult = unwrapData<Record<string, unknown>>(
        await runLark(
          [
            "base",
            "+record-list",
            "--base-token",
            MUSIC_BASE_TOKEN,
            "--table-id",
            MUSIC_ANALYSIS_TABLE_ID,
            "--format",
            "ndjson",
            "--output",
            relativeAnalysisPath,
            "--overwrite",
            "--as",
            "user",
          ],
          120_000,
          projectRoot,
        ),
      );
      if (analysisResult.has_more === true) {
        throw new Error("音乐分析表超过 2000 条，请缩小同步范围");
      }
      const snapshot = await loadMusicCatalog(Number(result.rev ?? 0));
      if (snapshot.entries.length === 0) {
        throw new Error("音乐资料库没有可用于 UE 状态映射的记录");
      }
      sendJson(response, 200, {
        ok: true,
        data: snapshot,
      });
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/lark/music/file"
    ) {
      const recordId = url.searchParams.get("recordId") ?? "";
      const fileToken = url.searchParams.get("fileToken") ?? "";
      const fileName = url.searchParams.get("fileName") ?? "music.wav";
      if (
        !/^rec[A-Za-z0-9]+$/.test(recordId) ||
        !/^[A-Za-z0-9_-]{8,}$/.test(fileToken)
      ) {
        throw new Error("音乐附件参数无效");
      }
      await ensureMusicDirectories();
      const path = musicAttachmentPath(fileToken, fileName);
      const projectRoot = dirname(dirname(dirname(path)));
      const relativeAttachmentPath =
        `./${relative(projectRoot, path).replaceAll("\\", "/")}`;
      try {
        const cached = await stat(path);
        if (cached.size === 0) {
          throw new Error("cached attachment is empty");
        }
      } catch {
        unwrapData(
          await runLark(
            [
              "base",
              "+record-download-attachment",
              "--base-token",
              MUSIC_BASE_TOKEN,
              "--table-id",
              MUSIC_TABLE_ID,
              "--record-id",
              recordId,
              "--file-token",
              fileToken,
              "--output",
              relativeAttachmentPath,
              "--overwrite",
              "--as",
              "user",
            ],
            180_000,
            projectRoot,
          ),
        );
      }
      await streamAudioFile(request, response, path, fileName);
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/lark/mira/discover") {
      sendJson(response, 200, { ok: true, data: await discoverMira() });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/lark/auth/start") {
      const currentStatus = await authStatus();
      const scopes = currentStatus.missingScopes;
      if (scopes.length === 0) {
        sendJson(response, 200, {
          ok: true,
          data: {
            alreadyAuthorized: true,
            status: currentStatus,
          },
        });
        return true;
      }
      if (
        state.pendingAuth &&
        Date.now() < state.pendingAuth.expiresAt &&
        state.pendingAuth.scopes.join(" ") === scopes.join(" ")
      ) {
        sendJson(response, 200, {
          ok: true,
          data: {
            verificationUrl: state.pendingAuth.verificationUrl,
            qrDataUrl: state.pendingAuth.qrDataUrl,
            expiresAt: state.pendingAuth.expiresAt,
            scopes: state.pendingAuth.scopes,
          },
        });
        return true;
      }
      state.pendingAuth = null;
      const envelope = await runLark([
        "auth",
        "login",
        "--scope",
        scopes.join(" "),
        "--no-wait",
        "--json",
      ]);
      const data = unwrapData<{
        device_code?: string;
        verification_url?: string;
        verification_uri_complete?: string;
        expires_in?: number;
      }>(envelope);
      const deviceCode = data.device_code;
      const verificationUrl =
        data.verification_url || data.verification_uri_complete;
      if (!deviceCode || !verificationUrl) {
        throw new Error("飞书未返回授权链接或 device_code");
      }
      const expiresAt =
        Date.now() +
        (Number.isFinite(data.expires_in)
          ? Number(data.expires_in) * 1_000
          : AUTH_FALLBACK_TTL_MS);
      state.pendingAuth = {
        deviceCode,
        verificationUrl,
        qrDataUrl: await generateQrDataUrl(verificationUrl),
        scopes,
        expiresAt,
      };
      sendJson(response, 200, {
        ok: true,
        data: {
          verificationUrl: state.pendingAuth.verificationUrl,
          qrDataUrl: state.pendingAuth.qrDataUrl,
          expiresAt: state.pendingAuth.expiresAt,
          scopes: state.pendingAuth.scopes,
        },
      });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/lark/auth/finish") {
      if (state.authCompletion) {
        sendJson(response, 200, {
          ok: true,
          data: await state.authCompletion,
        });
        return true;
      }
      const pendingAuth = state.pendingAuth;
      if (!pendingAuth) {
        const currentStatus = await authStatus();
        if (currentStatus.missingScopes.length === 0) {
          sendJson(response, 200, { ok: true, data: currentStatus });
          return true;
        }
        const missingError = new Error(
          "授权会话不存在或服务已重启，请重新点击授权",
        ) as Error & { code?: string };
        missingError.code = "AUTH_SESSION_MISSING";
        throw missingError;
      }
      if (Date.now() >= pendingAuth.expiresAt) {
        state.pendingAuth = null;
        const expiredError = new Error(
          "本次授权码已失效，请使用新生成的二维码重新授权",
        ) as Error & { code?: string };
        expiredError.code = "AUTH_CODE_EXPIRED";
        throw expiredError;
      }

      // Consume the code before awaiting so rapid double-clicks share one completion.
      state.pendingAuth = null;
      const completion = (async (): Promise<AuthStatusSnapshot> => {
        try {
          unwrapData(
            await runLark(
              ["auth", "login", "--device-code", pendingAuth.deviceCode],
              120_000,
            ),
          );
          state.miraBot = null;
          return await authStatus();
        } catch (completionError) {
          const currentStatus = await authStatus().catch(() => null);
          const requestedScopesGranted =
            currentStatus &&
            pendingAuth.scopes.every(
              (scope) => !currentStatus.missingScopes.includes(scope),
            );
          if (currentStatus && requestedScopesGranted) {
            return currentStatus;
          }
          throw completionError;
        } finally {
          state.authCompletion = null;
        }
      })();
      state.authCompletion = completion;
      sendJson(response, 200, { ok: true, data: await completion });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/director/mira") {
      const input = DirectorInputSchema.parse(await readJson(request));
      sendJson(response, 200, { ok: true, data: await analyzeWithMira(input) });
      return true;
    }
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "未知本地 API" },
    });
    return true;
  } catch (error) {
    const normalized = normalizeError(error);
    const status =
      normalized.code === "missing_scope" ||
      normalized.code === "authorization"
        ? 401
        : 503;
    sendJson(response, status, { ok: false, error: normalized });
    return true;
  }
}

function installMiddleware(
  server: ViteDevServer | PreviewServer,
): void {
  server.middlewares.use(async (request, response, next) => {
    if (!(await routeLarkRequest(request, response))) {
      next();
    }
  });
}

export function larkBridgePlugin(): Plugin {
  return {
    name: "local-lark-mira-bridge",
    configureServer(server) {
      installMiddleware(server);
    },
    configurePreviewServer(server) {
      installMiddleware(server);
    },
  };
}
