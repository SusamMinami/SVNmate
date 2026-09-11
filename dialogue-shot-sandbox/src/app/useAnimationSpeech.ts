import { useEffect, useRef, useState } from "react";
import type { SequenceSnapshot } from "../animationVoice";
import { SpeechRunSchema, speechTextKey, type SpeechAudio, type SpeechJob, type SpeechMediaChoice, type SpeechStatus } from "../animationSpeech";
import { animationRequest, type SubtitleRow } from "./useAnimationVoice";

export interface SpeechSession {
  sectionPath: string; media: SpeechMediaChoice[]; mediaId: string; audio?: SpeechAudio;
  mode: "align" | "asr"; cropStart: string; cropEnd: string; origin: string; confirmed: boolean;
  reference: Array<{ key: string; dialogueId?: number; text: string; selected: boolean }>;
  job?: SpeechJob; submittedRows?: string; adopted: boolean;
  error: string; loading: boolean; chosen: Record<string, boolean>;
}
const initial = (): SpeechSession => ({
  sectionPath: "", media: [], mediaId: "", mode: "align", cropStart: "0", cropEnd: "", origin: "",
  confirmed: false, reference: [], error: "", loading: false, adopted: false, chosen: {},
});

export function useAnimationSpeech(snapshot: SequenceSnapshot | undefined, rows: SubtitleRow[], active: boolean) {
  const [sessions, setSessions] = useState<Record<string, SpeechSession>>({});
  const [status, setStatus] = useState<SpeechStatus>();
  const path = snapshot?.assetPath ?? "";
  const session = sessions[path] ?? initial();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function update(patch: Partial<SpeechSession>, target = path) {
    if (alive.current) setSessions((old) => ({ ...old, [target]: { ...(old[target] ?? initial()), ...patch } }));
  }
  function edit(patch: Partial<SpeechSession>) {
    update({ ...patch, job: undefined, adopted: false, error: "", chosen: {} });
  }
  async function check() {
    update({ loading: true, error: "" });
    try { setStatus(await animationRequest<SpeechStatus>("speech-status", {})); }
    catch (e) { update({ error: String(e) }); }
    finally { update({ loading: false }); }
  }
  async function loadMedia() {
    if (!snapshot) return;
    update({ loading: true, error: "", audio: undefined, job: undefined, confirmed: false });
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
    update({ loading: true, error: "", audio: undefined, job: undefined, confirmed: false });
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
    update({ loading: true, error: "", job: undefined, adopted: false });
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
      update({ job, submittedRows: JSON.stringify(rows), chosen: {} });
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
          update({ job, error: job.error ?? "" }, path);
          if (job.state === "running") timer = setTimeout(() => void poll(), 1000);
        }
      } catch (e) {
        if (!disposed) {
          update({ error: `状态读取失败，可取消任务或稍后重试：${String(e)}` }, path);
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
    update({ loading: true });
    try { update({ job: await animationRequest<SpeechJob>("speech-cancel", { id: session.job.id }), error: "" }); }
    catch (e) { update({ error: String(e) }); }
    finally { update({ loading: false }); }
  }
  function adoptedRows(): SubtitleRow[] {
    if (!snapshot || !session.audio || !session.job?.result) throw new Error("没有可采用的语音结果");
    if (session.audio.revision !== snapshot.revision || session.submittedRows !== JSON.stringify(rows)) {
      throw new Error("动画或字幕草稿已变化，请重新识别/对齐，避免覆盖较新的编辑");
    }
    const chosen = session.job.result.lines.filter((line) => session.chosen[line.key]);
    if (!chosen.length) throw new Error("请先勾选要采用的语音结果");
    const next = rows.map((row) => ({ ...row }));
    const used = new Set<string>();
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
      Object.assign(target, { start: line.start.toFixed(3), end: line.end.toFixed(3), selected: true,
        speechText: line.text, timeSource: session.job.result.mode === "align" ? "强制对齐" : "语音识别" });
    }
    return next;
  }
  return { session, status, update, edit, check, loadMedia, prepareAudio, start, cancel, adoptedRows };
}
