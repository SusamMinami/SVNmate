import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  SequencePatchSchema, SequencePathSchema, sequencePatchProblems,
  type SequenceSnapshot, type SequenceReview,
} from "../src/animationVoice";
import { readAnimationVoiceRows } from "./configRepository";
import { getUnrealMcpEndpoint, UnrealMcpConnection, type UnrealInvoker } from "./ue/transport";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const reviews = new Map<string, { review: SequenceReview; expires: number; endpoint: string }>();
let busy = false;

async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (busy) throw new Error("动画语音服务正在处理另一项请求，请稍后重试");
  busy = true;
  try { return await work(); } finally { busy = false; }
}

async function evaluate(connection: UnrealInvoker, request: Record<string, unknown>): Promise<unknown> {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const source = await readFile(resources
    ? join(resources, "ue-scripts", "animation_voice.py")
    : join(process.cwd(), "server", "ue", "scripts", "animation_voice.py"), "utf8");
  const script = `_request = __import__('json').loads(${JSON.stringify(JSON.stringify(request))})\n${source}`;
  const Expression = `(lambda ns: (exec(${JSON.stringify(script)}, ns), __import__('json').dumps(ns['_result'], ensure_ascii=True), ns.clear())[1])({'unreal': unreal})`;
  const response = await connection.invoke("script.eval_python_expression", { Expression }, { timeoutMs: 120_000 }) as { bSuccess?: boolean; Result?: string };
  if (response?.bSuccess === false) throw new Error(response.Result || "UE Python 执行失败");
  let text = String(response?.Result ?? "").trim();
  if (text.startsWith("'") && text.endsWith("'")) {
    text = text.slice(1, -1).replaceAll("\\'", "'").replaceAll("\\\\", "\\");
  } else if (text.startsWith('"')) {
    text = JSON.parse(text) as string;
  }
  return JSON.parse(text);
}

interface TextObject { path: string; lines: string[] }

function textObjects(text: string): Map<string, TextObject> {
  const stack: TextObject[] = [];
  const objects = new Map<string, TextObject>();
  for (const line of text.split(/\r?\n/)) {
    const begin = /^\s*Begin Object\b.*\bName="([^"]+)"/.exec(line);
    if (begin) {
      const path = [...stack.map((o) => o.path.split(".").at(-1)!), begin[1]].slice(1).join(".");
      stack.push({ path, lines: [] });
    } else if (/^\s*End Object\s*$/.test(line)) {
      const object = stack.pop();
      if (object && object.lines.length >= (objects.get(object.path)?.lines.length ?? 0)) objects.set(object.path, object);
    } else {
      stack.at(-1)?.lines.push(line.trim());
    }
  }
  if (stack.length) throw new Error("UE 文本导出不完整");
  return objects;
}

// UE text tuples contain nested structs and quoted strings; only split at depth zero.
function tupleItems(value: string): string[] {
  const inner = value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
  const items: string[] = [];
  let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '"' && inner[i - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (inner[i] === "(") depth += 1;
    if (inner[i] === ")") depth -= 1;
    if (inner[i] === "," && depth === 0) { items.push(inner.slice(start, i)); start = i + 1; }
  }
  if (start < inner.length) items.push(inner.slice(start));
  return items;
}

export function attachSequenceEndpoints(snapshot: SequenceSnapshot, text: string): void {
  const objects = textObjects(text);
  const root = objects.get("");
  const directorName = /DirectorBlueprint=Blueprint'"([^"]+)"'/.exec(root?.lines.join("\n") ?? "")?.[1] ?? "";
  const director = objects.get(directorName);
  snapshot.director = {
    path: directorName ? `${snapshot.assetPath}:${directorName}` : "",
    parent: /ParentClass=[^']+'"([^"]+)"'/.exec(director?.lines.join("\n") ?? "")?.[1] ?? "",
  };
  for (const event of snapshot.events) {
    const section = objects.get(event.sectionPath.split(":")[1]);
    const channelLine = section?.lines.find((line) => line.startsWith("EventChannel="));
    const values = channelLine && tupleItems(channelLine.slice("EventChannel=".length)).find((v) => v.startsWith("KeyValues="));
    const items = values ? tupleItems(values.slice("KeyValues=".length)) : [];
    const peers = snapshot.events.filter((e) => e.sectionPath === event.sectionPath && e.channel === event.channel);
    if (event.channel !== 0 || items.length !== peers.length) continue;
    const raw = items[event.key] ?? "";
    event.endpoint = /WeakEndpoint=K2Node_CustomEvent'"([^"]+)"'/.exec(raw)?.[1] ?? "";
    if (!/Function=Function'"/.test(raw) || !event.endpoint) continue;
    const path = event.endpoint.split(":")[1];
    const endpoint = objects.get(path);
    const then = endpoint?.lines.filter((line) => /PinName="then"/.test(line) && /PinCategory="exec"/.test(line)) ?? [];
    if (then.length !== 1) continue;
    const links = /LinkedTo=\(([^)]+)\)/.exec(then[0])?.[1].split(",").filter(Boolean) ?? [];
    if (links.length !== 1) continue;
    const [nodeName, pinId] = links[0].trim().split(/\s+/);
    const node = objects.get(path.slice(0, path.lastIndexOf(".") + 1) + nodeName);
    const lines = node?.lines ?? [];
    if (!lines.some((line) => line.includes(`PinId=${pinId},PinName="execute"`) && line.includes("LinkedTo=("))) continue;
    const functionLine = lines.find((line) => line.startsWith("FunctionReference=")) ?? "";
    if (!functionLine.includes("bSelfContext=True")) continue;
    const name = /MemberName="([^"]+)"/.exec(functionLine)?.[1];
    if (name === "Show SkipButton") {
      const mark = lines.find((line) => line.includes('PinName="Mark"')) ?? "";
      if (!mark.includes("LinkedTo=") && mark.includes('DefaultValue="skip"')) event.role = "show";
    } else if (name === "HideSkipButton") {
      event.role = "hide";
    }
  }
  snapshot.skipBlockedReasons = [];
  if (!directorName) snapshot.skipBlockedReasons.push("缺少 Director Blueprint，请在 UE 创建并配置跳过端点");
  else if (snapshot.director.parent !== "/Game/Seria/Sequences/CommonSequenceDirector.CommonSequenceDirector_C") {
    snapshot.skipBlockedReasons.push("Director 父类不是 CommonSequenceDirector，第一版不会自动修改父类");
  }
  for (const role of ["show", "hide"]) {
    if (snapshot.events.filter((event) => event.role === role).length !== 1) {
      snapshot.skipBlockedReasons.push(`无法唯一确认${role === "show" ? "显示" : "隐藏"}跳过按钮的已绑定端点，请在 UE 检查`);
    }
  }
}

async function exportedText(connection: UnrealInvoker, path: string): Promise<string> {
  const file = String(await connection.invoke("asset.export_asset_to_text_file", { AssetPath: path }));
  if (!file) throw new Error("无法导出动画配置");
  try { return await readFile(file, "utf8"); }
  finally {
    if (/[/\\]Saved[/\\]McpTemp[/\\].+\.txt$/i.test(file)) await unlink(file).catch(() => undefined);
  }
}

async function scan(connection: UnrealInvoker, assetPath: string): Promise<SequenceSnapshot> {
  const snapshot = await evaluate(connection, { action: "scan", assetPath }) as SequenceSnapshot;
  const text = await exportedText(connection, snapshot.assetPath);
  attachSequenceEndpoints(snapshot, text);
  snapshot.revision = hash({ state: snapshot.stateRevision, text });
  snapshot.voices = [];
  try {
    const ids = new Set(snapshot.tracks.flatMap((t) => t.sections.map((s) => s.dialogueId)));
    snapshot.voices = (await readAnimationVoiceRows()).filter((v) =>
      ids.has(v.id) || v.sequence === snapshot.name || v.sequence === `${snapshot.name}.wav`)
      .map(({ id, name, text: content, delayMs }) => ({ id, name, text: content, delayMs }));
  } catch (error) {
    snapshot.warnings.push(`配音表读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return snapshot;
}

async function connected<T>(work: (connection: UnrealInvoker) => Promise<T>): Promise<T> {
  const connection = new UnrealMcpConnection();
  try { await connection.connect(); return await work(connection); }
  finally { connection.close(); }
}

export async function listAnimationSequences(raw: unknown) {
  const { root } = z.object({ root: z.string().trim().regex(/^\/Game(?:\/[A-Za-z0-9_]+)*$/) }).parse(raw);
  return exclusive(() => connected((c) => evaluate(c, { action: "catalog", root })));
}

export async function scanAnimationSequence(raw: unknown) {
  const { assetPath } = z.object({ assetPath: SequencePathSchema }).parse(raw);
  return exclusive(() => connected((c) => scan(c, assetPath)));
}

export async function reviewAnimationSequence(raw: unknown): Promise<SequenceReview> {
  const patch = SequencePatchSchema.parse(raw);
  return exclusive(() => connected(async (c) => {
    const snapshot = await scan(c, patch.assetPath);
    const problems = sequencePatchProblems(snapshot, patch);
    if (problems.length) throw new Error(problems.join("\n"));
    const changes = patch.subtitles.map((s) => {
      const old = snapshot.tracks.flatMap((t) => t.sections).find((section) => section.path === s.sectionPath);
      return `${old ? `修改字幕 ${old.dialogueId}（${old.start?.toFixed(3)}–${old.end?.toFixed(3)}s）` : "新增字幕"} → ${s.dialogueId} / ${s.start.toFixed(3)}–${s.end.toFixed(3)}s`;
    });
    if (patch.skipTime !== null) changes.push(`skip 标记：${snapshot.marks.find((m) => m.label === "skip")?.seconds.toFixed(3) ?? "未配置"} → ${patch.skipTime.toFixed(3)}s`);
    if (patch.eventTimes) for (const role of ["show", "hide"] as const) changes.push(
      `${role === "show" ? "显示" : "隐藏"}跳过按钮：${snapshot.events.find((e) => e.role === role)?.seconds.toFixed(3)} → ${patch.eventTimes[role].toFixed(3)}s（保留端点）`);
    const token = randomUUID();
    const review = { token, patch, changes };
    for (const [key, value] of reviews) if (value.expires < Date.now()) reviews.delete(key);
    if (reviews.size >= 100) reviews.delete(reviews.keys().next().value!);
    reviews.set(token, { review, expires: Date.now() + 10 * 60_000, endpoint: JSON.stringify(getUnrealMcpEndpoint()) });
    return review;
  }));
}

export async function applyAnimationSequence(raw: unknown) {
  const { token } = z.object({ token: z.string().uuid() }).parse(raw);
  return exclusive(() => connected(async (c) => {
    const stored = reviews.get(token);
    reviews.delete(token);
    if (!stored || stored.expires < Date.now()) throw new Error("审核已失效，请重新检查配置");
    const endpoint = JSON.stringify(getUnrealMcpEndpoint());
    if (stored.endpoint !== endpoint) throw new Error("UE 连接目标已变化，请重新审核");
    const { patch } = stored.review;
    const before = await scan(c, patch.assetPath);
    const problems = sequencePatchProblems(before, patch);
    if (problems.length) throw new Error(problems.join("\n"));
    const eventTargets = patch.eventTimes ? (["show", "hide"] as const).map((role) => ({
      ...before.events.find((e) => e.role === role)!, seconds: patch.eventTimes![role],
    })) : [];
    await evaluate(c, { action: "apply", assetPath: patch.assetPath, stateRevision: before.stateRevision, patch, eventTargets });
    // No automatic save: the user retains UE's normal review/save workflow.
    try { return { applied: true, snapshot: await scan(c, patch.assetPath), message: "已写入并回读；动画尚未保存，请在 UE 检查并保存" }; }
    catch (error) {
      return { applied: true, snapshot: null, message: `已写入，但最终扫描失败；请在 UE 检查，勿重复提交：${String(error)}` };
    }
  }));
}
