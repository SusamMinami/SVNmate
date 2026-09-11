import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SpeechRunSchema, type SpeechJob, type SpeechResult, type SpeechStatus } from "../src/animationSpeech";
import { getAnimationSpeechAudio } from "./animationSpeechMedia";
import { scanAnimationSequence } from "./animationVoice";

const jobs = new Map<string, SpeechJob>();
let active: { job: SpeechJob; child?: ChildProcess } | null = null;
const root = () => process.env.STORYBOARD_SPEECH_ROOT || join(process.env.LOCALAPPDATA || homedir(), "ShotSandbox", "speech-runtime");
const python = () => join(root(), "venv", "Scripts", "python.exe");
export async function animationSpeechStatus(): Promise<SpeechStatus> {
  const ready = ["Qwen3-ASR-0.6B", "Qwen3-ForcedAligner-0.6B"].every((name) =>
    existsSync(join(root(), "models", name, "config.json")) && existsSync(join(root(), "models", name, "model.safetensors"))) &&
    existsSync(python()) && existsSync(join(root(), "ready.json"));
  return {
    ready, root: root(), busy: Boolean(active),
    reason: ready ? "Qwen3 ASR / ForcedAligner · 本地离线" : "语音环境未就绪，请运行 scripts/install-speech-runtime.ps1",
  };
}

const ResultSchema = z.object({
  mode: z.enum(["align", "asr"]), model: z.string(), device: z.string(), elapsed: z.number().finite(),
  warnings: z.array(z.string()),
  lines: z.array(z.object({
    key: z.string(), dialogueId: z.number().int().positive().nullish(), text: z.string(),
    start: z.number().finite(), end: z.number().finite(),
    audioStart: z.number().finite(), audioEnd: z.number().finite(), warnings: z.array(z.string()),
  })).max(500),
});

export async function startAnimationSpeech(raw: unknown): Promise<SpeechJob> {
  const request = SpeechRunSchema.parse(raw);
  if (active) throw new Error("已有语音任务运行中，请等待或取消");
  const job: SpeechJob = { id: randomUUID(), state: "running", stage: "核对音频和动画快照" };
  const lease = { job } as { job: SpeechJob; child?: ChildProcess };
  active = lease;
  try {
    const status = await animationSpeechStatus();
    if (!status.ready) throw new Error(status.reason);
    const { audio, path } = await getAnimationSpeechAudio({ token: request.audioToken });
    if (request.cropEnd > audio.duration + 0.001) throw new Error("裁剪范围超出源音频");
    const snapshot = await scanAnimationSequence({ assetPath: audio.assetPath });
    if (snapshot.revision !== audio.revision) throw new Error("UE 动画已变化，请重新提取音频");
    if (request.timelineOrigin + request.cropStart < snapshot.start - 0.001 ||
        request.timelineOrigin + request.cropEnd > snapshot.end + 0.001) throw new Error("映射后的音频范围超出当前动画播放范围");
    if (request.lines.reduce((sum, line) => sum + line.text.length, 0) > 12000) throw new Error("台词超过单次 12000 字限制");
    if (jobs.size >= 30) jobs.delete(jobs.keys().next().value!);
    jobs.set(job.id, job);
    const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const script = resources ? join(resources, "speech", "worker.py") : join(process.cwd(), "server", "speech", "worker.py");
    const child = spawn(python(), ["-u", script], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
    });
    lease.child = child;
    let buffer = "", stderr = "", result: SpeechResult | undefined, workerError = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 15 * 60_000);
    const fail = (message: string) => {
      if (job.state !== "cancelled") { job.state = "failed"; job.error = message; job.stage = "语音任务失败"; }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) { workerError = "语音输出超出限制"; child.kill(); return; }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        try {
          const packet = JSON.parse(line) as { type: string; stage?: string; error?: string; result?: unknown };
          if (packet.type === "progress" && job.state === "running") job.stage = packet.stage || job.stage;
          if (packet.type === "error") workerError = packet.error || "模型执行失败";
          if (packet.type === "result") {
            const parsed = ResultSchema.parse(packet.result);
            result = { ...parsed, lines: parsed.lines.map((l) => ({ ...l, dialogueId: l.dialogueId ?? undefined })) };
          }
        } catch { workerError = "语音模型返回格式不正确"; }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-6000); });
    child.stdin.on("error", (error) => { workerError = error.message; });
    child.on("error", (error) => fail(`无法启动语音环境：${error.message}`));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (job.state === "running") {
        if (code === 0 && result && !workerError) { job.state = "complete"; job.result = result; job.stage = "完成，显存已释放"; }
        else fail(timedOut ? "语音任务超过 15 分钟，已停止" : workerError || stderr || `语音进程退出 (${code})`);
      }
      if (active === lease) active = null;
    });
    child.stdin.end(JSON.stringify({ ...request, root: root(), path }));
    return job;
  } catch (error) {
    if (active === lease) active = null;
    throw error;
  }
}

export async function getAnimationSpeechJob(raw: unknown): Promise<SpeechJob> {
  const { id } = z.object({ id: z.string().uuid() }).parse(raw);
  const job = jobs.get(id);
  if (!job) throw new Error("语音任务不存在或已过期");
  return job;
}

export async function cancelAnimationSpeech(raw: unknown): Promise<SpeechJob> {
  const job = await getAnimationSpeechJob(raw);
  if (job.state === "running" && active?.job.id === job.id) {
    job.state = "cancelled"; job.stage = "已取消";
    active.child?.kill();
  }
  return job;
}
