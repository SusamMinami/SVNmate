import { useEffect, useRef, useState } from "react";
import type { SequenceSnapshot } from "../animationVoice";
import { SpeechRunSchema, speechTextKey, type SpeechAudio, type SpeechJob, type SpeechMediaChoice, type SpeechStatus } from "../animationSpeech";
import { animationRequest, type SubtitleRow } from "./useAnimationVoice";

export interface SpeechSession {
  sectionPath: string; media: SpeechMediaChoice[]; mediaId: string; audio?: SpeechAudio;
  mode: "align" | "asr"; cropStart: string; cropEnd: string; origin: string; confirmed: boolean;
  reference: Array<{ key: string; dialogueId?: number; text: string; selected: boolean }>;
  job?: SpeechJob; submittedRows?: string;
  adoptedKeys: Record<string, boolean>; adoptedTargets: Record<string, string>; auditioned: Record<string, boolean>;
  error: string; loading: boolean; loadingStage?: string; jobStatusUnknown?: boolean;
}
const initial = (): SpeechSession => ({
  sectionPath: "", media: [], mediaId: "", mode: "align", cropStart: "0", cropEnd: "", origin: "",
  confirmed: false, reference: [], error: "", loading: false, adoptedKeys: {}, adoptedTargets: {}, auditioned: {},
});
const rowsFingerprint = (rows: SubtitleRow[]) =>
  JSON.stringify(rows.map(({ selected: _selected, ...row }) => row));

export function useAnimationSpeech(snapshot: SequenceSnapshot | undefined, rows: SubtitleRow[], active: boolean) {
  const [sessions, setSessions] = useState<Record<string, SpeechSession>>({});
  const [status, setStatus] = useState<SpeechStatus>();
  const path = snapshot?.assetPath ?? "";
  const session = sessions[path] ?? initial();
  const alive = useRef(true);
  const checked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function update(patch: Partial<SpeechSession>, target = path) {
    if (alive.current) setSessions((old) => ({ ...old, [target]: { ...(old[target] ?? initial()), ...patch } }));
  }
  function edit(patch: Partial<SpeechSession>) {
    update({ ...patch, job: undefined, adoptedKeys: {}, adoptedTargets: {}, auditioned: {}, error: "", jobStatusUnknown: false });
  }
  function updateJob(job: SpeechJob, target: string) {
    if (!alive.current) return;
    setSessions((old) => {
      const current = old[target];
      // A late poll cannot revive a cancelled/finished job or replace a newer run.
      if (!current?.job || current.job.id !== job.id || current.job.state !== "running") return old;
      return { ...old, [target]: { ...current, job, error: job.error ?? "", jobStatusUnknown: false } };
    });
  }
  async function check() {
    update({ loading: true, loadingStage: "正在检测端侧语音环境…", error: "" });
    try { setStatus(await animationRequest<SpeechStatus>("speech-status", {})); }
    catch (e) { update({ error: String(e) }); }
    finally { update({ loading: false }); }
  }
  async function install() {
    update({ loading: true, loadingStage: "正在启动端侧模型安装…", error: "" });
    try { setStatus(await animationRequest<SpeechStatus>("speech-install", {})); }
    catch (e) { update({ error: e instanceof Error ? e.message : String(e) }); }
    finally { update({ loading: false }); }
  }
  useEffect(() => {
    if (!active || checked.current) return;
    checked.current = true;
    void check();
  // Environment detection is global and read-only, so it runs once per mounted workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    if (!active || !status?.installing) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await animationRequest<SpeechStatus>("speech-status", {});
        if (disposed) return;
        setStatus(next);
        if (next.installing) timer = setTimeout(() => void poll(), 1500);
      } catch (e) {
        if (!disposed) {
          update({ error: `安装状态读取失败：${e instanceof Error ? e.message : String(e)}` });
          timer = setTimeout(() => void poll(), 4000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { disposed = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, status?.installing]);
  async function loadMedia() {
    if (!snapshot) return;
    update({ loading: true, loadingStage: "正在读取中文媒体…", error: "", audio: undefined, job: undefined, confirmed: false });
    try {
      const found = await animationRequest<SpeechMediaChoice[]>("speech-media", {
        assetPath: path, revision: snapshot.revision, sectionPath: session.sectionPath,
      });
      update({ media: found, mediaId: found.length === 1 ? found[0].id : "" });
      setStatus(await animationRequest<SpeechStatus>("speech-status", {}));
    } catch (e) { update({ error: e instanceof Error ? e.message : String(e), media: [], mediaId: "" }); }
    finally { update({ loading: false }); }
  }
  async function prepareAudio() {
    if (!snapshot) return;
    update({ loading: true, loadingStage: "正在提取本地语音…", error: "", audio: undefined, job: undefined, confirmed: false });
    try {
      const audio = await animationRequest<SpeechAudio>("speech-audio", {
        assetPath: path, revision: snapshot.revision, sectionPath: session.sectionPath, mediaId: session.mediaId,
      });
      update({
        audio, origin: String(audio.sectionStart), cropStart: "0",
        cropEnd: String(Math.max(0, Math.min(audio.duration, snapshot.end - audio.sectionStart, 300))),
        reference: rows.filter((row) => snapshot.voices.some((v) => String(v.id) === row.dialogueId))
          .map((row) => ({
            key: row.key, dialogueId: Number(row.dialogueId),
            text: snapshot.voices.find((v) => String(v.id) === row.dialogueId)!.text, selected: true,
          })),
      });
    } catch (e) { update({ error: e instanceof Error ? e.message : String(e) }); }
    finally { update({ loading: false }); }
  }
  async function start() {
    if (!snapshot || !session.audio) return;
    update({ loading: true, loadingStage: "正在提交语音任务…", error: "", job: undefined, jobStatusUnknown: false, adoptedKeys: {}, adoptedTargets: {}, auditioned: {} });
    try {
      if (!session.confirmed) throw new Error("请确认音频与动画时间映射");
      if (!session.cropStart.trim() || !session.cropEnd.trim() || !session.origin.trim()) throw new Error("请填写裁剪范围及时间映射");
      if (session.audio.revision !== snapshot.revision) throw new Error("动画快照已变化，请重新提取语音");
      const parsed = SpeechRunSchema.safeParse({
        audioToken: session.audio.token, mode: session.mode,
        cropStart: Number(session.cropStart), cropEnd: Number(session.cropEnd), timelineOrigin: Number(session.origin),
        lines: session.mode === "align" ? session.reference.filter((l) => l.selected).map(({ selected: _selected, ...line }) => line) : [],
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "音频参数无效");
      const job = await animationRequest<SpeechJob>("speech-start", parsed.data);
      update({ job, submittedRows: rowsFingerprint(rows) });
    } catch (e) { update({ error: e instanceof Error ? e.message : String(e) }); }
    finally { update({ loading: false }); }
  }
  useEffect(() => {
    if (!active || !session.job || session.job.state !== "running") return;
    const id = session.job.id;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await animationRequest<SpeechJob>("speech-job", { id });
        if (!disposed) {
          updateJob(job, path);
          if (job.state === "running") timer = setTimeout(() => void poll(), 1000);
        }
      } catch (e) {
        if (!disposed) {
          update({ error: `状态读取失败，可取消任务或稍后重试：${String(e)}`, jobStatusUnknown: true }, path);
          timer = setTimeout(() => void poll(), 4000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { disposed = true; clearTimeout(timer); };
  // Polling follows the selected asset; hidden workspaces keep the server task, not the timer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, path, session.job?.id, session.job?.state]);
  async function cancel() {
    if (!session.job) return;
    update({ loading: true, loadingStage: "正在取消语音任务…" });
    try { updateJob(await animationRequest<SpeechJob>("speech-cancel", { id: session.job.id }), path); }
    catch (e) { update({ error: String(e), jobStatusUnknown: true }); }
    finally { update({ loading: false }); }
  }
  function adoptedRows(keys: string[]) {
    if (!snapshot || !session.audio || !session.job?.result) throw new Error("没有可采用的语音结果");
    if (session.audio.revision !== snapshot.revision || session.submittedRows !== rowsFingerprint(rows)) {
      throw new Error("动画或字幕草稿已变化，请重新识别/对齐，避免覆盖较新的编辑");
    }
    const requested = new Set(keys);
    const chosen = session.job.result.lines.filter((line) => requested.has(line.key) && !session.adoptedKeys[line.key]);
    if (!chosen.length) throw new Error("没有可采用的模型时间");
    const next = rows.map((row) => ({ ...row }));
    const adoptedTargets = { ...session.adoptedTargets };
    const used = new Set(Object.values(adoptedTargets));
    for (const line of chosen) {
      if (!(line.end > line.start && line.start >= snapshot.start && line.end <= snapshot.end)) throw new Error("结果时间无效或超出动画范围，请重新裁剪/对齐");
      let target: SubtitleRow | undefined;
      if (session.job.result.mode === "align") {
        target = next.find((row) => row.key === line.key);
        if (!target) throw new Error("对齐目标字幕已不存在");
      } else {
        const voices = snapshot.voices.filter((v) => speechTextKey(v.text) === speechTextKey(line.text));
        if (voices.length === 1) {
          const candidates = next.filter((r) => r.dialogueId === String(voices[0].id));
          if (candidates.length === 1 && !used.has(candidates[0].key)) target = candidates[0];
        }
        if (!target) {
          target = { key: crypto.randomUUID(), dialogueId: "", start: "", end: "", selected: true };
          next.push(target);
        }
      }
      used.add(target.key);
      adoptedTargets[line.key] = target.key;
      Object.assign(target, { start: line.start.toFixed(3), end: line.end.toFixed(3), selected: true,
        speechText: line.text, timeSource: session.job.result.mode === "align" ? "强制对齐" : "语音识别" });
    }
    return {
      rows: next, adoptedTargets, submittedRows: rowsFingerprint(next),
      adoptedKeys: { ...session.adoptedKeys, ...Object.fromEntries(chosen.map((line) => [line.key, true])) },
    };
  }
  return { session, status, update, edit, check, install, loadMedia, prepareAudio, start, cancel, adoptedRows };
}
