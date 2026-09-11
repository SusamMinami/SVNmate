import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { z } from "zod";
import { SpeechMediaRequestSchema, type SpeechAudio, type SpeechMediaChoice } from "../src/animationSpeech";
import { scanAnimationSequence } from "./animationVoice";
import { configuredVgmstreamPath, configuredWwiseRoot, wwiseShortId } from "./soundEffectPreview";

const exec = promisify(execFile);
const MediaSchema = z.object({
  Id: z.string().regex(/^\d+$/), Path: z.string(), ShortName: z.string().optional(), Language: z.string().optional(),
});
const BankSchema = z.object({
  ShortName: z.string(), Language: z.string().optional(), Media: z.array(MediaSchema).default([]),
  Events: z.array(z.object({
    Name: z.string(), DurationType: z.string().optional(),
    MediaRefs: z.array(z.object({ Id: z.string() })).optional(),
  })).default([]),
});
const MetadataSchema = z.object({ SoundBanksInfo: z.object({ SoundBanks: z.array(BankSchema) }) });
const audioCache = new Map<string, { audio: SpeechAudio; path: string; expires: number; fingerprint: string }>();
const locks = new Map<string, Promise<void>>();

export async function containedMediaPath(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const file = await realpath(resolve(base, path));
  const rel = relative(base, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !file.toLowerCase().endsWith(".wem")) {
    throw new Error("Wwise 媒体路径越界或类型无效");
  }
  return file;
}

export async function resolveSpeechMedia(eventName: string, root = configuredWwiseRoot()) {
  if (!/^A_Voice_[A-Za-z0-9_]+$/.test(eventName)) throw new Error("只支持明确的 A_Voice 语音事件");
  const eventRoot = join(root, "Event", "CN");
  const bucket = String(wwiseShortId(eventName)).slice(0, 2);
  let file = join(eventRoot, bucket, `${eventName}.json`);
  try { await stat(file); } catch {
    const candidates: string[] = [];
    for (const entry of await readdir(eventRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(eventRoot, entry.name, `${eventName}.json`);
      try { await stat(candidate); candidates.push(candidate); } catch { /* Other event bucket. */ }
    }
    if (candidates.length !== 1) throw new Error("未找到唯一中文 Wwise 事件元数据");
    file = candidates[0];
  }
  const data = MetadataSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const banks = data.SoundBanksInfo.SoundBanks.filter((b) => b.ShortName === eventName && b.Language === "CN");
  if (banks.length !== 1) throw new Error("中文语音 Bank 缺失或不唯一");
  const bank = banks[0];
  const events = bank.Events.filter((e) => e.Name === eventName);
  if (events.length !== 1 || events[0].DurationType !== "OneShot") throw new Error("仅支持单次播放语音；循环或未知事件不能自动对齐");
  const refs = events[0].MediaRefs;
  if (!refs?.length) throw new Error("事件未提供 MediaRefs，不能猜测音频");
  const media = bank.Media.filter((m) => refs.some((ref) => ref.Id === m.Id) && (m.Language ?? bank.Language) === "CN");
  if (!media.length || new Set(media.map((m) => m.Id)).size !== media.length) throw new Error("中文语音媒体缺失或重复");
  return Promise.all(media.map(async (m) => ({
    id: m.Id, name: m.ShortName || m.Id, language: "CN", eventName,
    path: await containedMediaPath(root, m.Path),
  })));
}

async function audioSection(raw: unknown) {
  const request = SpeechMediaRequestSchema.parse(raw);
  const snapshot = await scanAnimationSequence({ assetPath: request.assetPath });
  if (snapshot.revision !== request.revision) throw new Error("动画已变化，请重新扫描后提取音频");
  const section = snapshot.tracks.flatMap((t) => t.sections).find((s) => s.path === request.sectionPath);
  if (!section || !section.active || !section.audioEvent || section.start === null) throw new Error("所选语音 Section 无效、已禁用或起点无界");
  return { request, snapshot, section, media: await resolveSpeechMedia(section.audioEvent) };
}

export async function listAnimationSpeechMedia(raw: unknown): Promise<SpeechMediaChoice[]> {
  return (await audioSection(raw)).media.map(({ path: _path, ...choice }) => choice);
}

export function wavDuration(buffer: Buffer): number {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("解码结果不是 WAV");
  let rate = 0, size = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32LE(offset + 4);
    const type = buffer.toString("ascii", offset, offset + 4);
    if (offset + 8 + length > buffer.length) throw new Error("WAV 文件截断");
    if (type === "fmt " && length >= 16) rate = buffer.readUInt32LE(offset + 16);
    if (type === "data") size += length;
    offset += 8 + length + (length % 2);
  }
  if (!rate || !size) throw new Error("WAV 没有有效音频数据");
  return size / rate;
}

export async function prepareAnimationSpeechAudio(raw: unknown): Promise<SpeechAudio> {
  const { mediaId } = z.object({ mediaId: z.string().regex(/^\d+$/) }).parse(raw);
  const { request, section, media } = await audioSection(raw);
  const source = media.find((m) => m.id === mediaId);
  if (!source) throw new Error("所选媒体不属于当前语音事件");
  const info = await stat(source.path);
  const digest = createHash("sha256").update(JSON.stringify([source.path, info.size, info.mtimeMs])).digest("hex");
  const cache = join(process.env.STORYBOARD_PROJECT_ROOT || tmpdir(), ".storyboard-data", "animation-speech");
  await mkdir(cache, { recursive: true });
  const path = join(cache, `${digest}.wav`);
  let conversion = locks.get(path);
  if (!conversion) {
    conversion = (async () => {
      try { if ((await stat(path)).size > 44) return; } catch { /* Decode first access. */ }
      const temporary = `${path}.${randomUUID()}.tmp.wav`;
      try {
        const decoder = configuredVgmstreamPath();
        await exec(decoder, ["-i", "-o", temporary, source.path], {
          cwd: dirname(decoder), windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
        });
        if ((await stat(temporary)).size > 512 * 1024 * 1024) throw new Error("音频过大，请先在音频工程中拆分");
        wavDuration(await readFile(temporary));
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }); }
    })();
    locks.set(path, conversion);
  }
  try { await conversion; } finally { if (locks.get(path) === conversion) locks.delete(path); }
  const duration = wavDuration(await readFile(path));
  for (const [key, value] of audioCache) if (value.expires < Date.now()) audioCache.delete(key);
  if (audioCache.size >= 100) audioCache.delete(audioCache.keys().next().value!);
  const token = randomUUID();
  const audio: SpeechAudio = {
    token, url: `/api/ue/animation-voice/audio-file?token=${token}`, duration,
    eventName: source.eventName, mediaId, ...request, sectionStart: section.start!,
  };
  const cached = await stat(path);
  audioCache.set(token, { audio, path, expires: Date.now() + 12 * 60 * 60_000, fingerprint: `${cached.size}:${cached.mtimeMs}` });
  return audio;
}

export async function getAnimationSpeechAudio(raw: unknown) {
  const { token } = z.object({ token: z.string().uuid() }).parse(raw);
  const record = audioCache.get(token);
  if (!record || record.expires < Date.now()) throw new Error("音频会话已失效，请重新提取");
  const info = await stat(record.path);
  if (`${info.size}:${info.mtimeMs}` !== record.fingerprint) throw new Error("音频缓存已变化，请重新提取");
  return record;
}
