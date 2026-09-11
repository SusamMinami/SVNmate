import { useEffect, useRef, useState } from "react";
import {
  SequencePatchSchema, sequencePatchProblems,
  type SequenceSnapshot, type SequenceReview,
} from "../animationVoice";

export interface SubtitleRow {
  key: string;
  sectionPath?: string;
  dialogueId: string;
  start: string;
  end: string;
  selected: boolean;
  speechText?: string;
  timeSource?: string;
}
export async function animationRequest<T>(action: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/ue/animation-voice/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json() as { ok: boolean; data: T; error?: { message?: string } };
  if (!response.ok || !result.ok) throw new Error(result.error?.message || "动画语音请求失败");
  return result.data;
}

export function useAnimationVoice() {
  const [root, setRoot] = useState("/Game/Seria/Sequences");
  const [catalog, setCatalog] = useState<Array<{ path: string; name: string }>>([]);
  const [snapshots, setSnapshots] = useState<Record<string, SequenceSnapshot>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState("");
  const [draftRevision, setDraftRevision] = useState("");
  const [rows, setRows] = useState<SubtitleRow[]>([]);
  const [markEnabled, setMarkEnabled] = useState(false);
  const [skipTime, setSkipTime] = useState("");
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [showTime, setShowTime] = useState("");
  const [hideTime, setHideTime] = useState("");
  const [review, setReview] = useState<SequenceReview | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopped = useRef(false);
  const drafts = useRef(new Map<string, {
    rows: SubtitleRow[]; markEnabled: boolean; skipTime: string;
    eventsEnabled: boolean; showTime: string; hideTime: string; revision: string;
  }>());
  useEffect(() => () => { stopped.current = true; }, []);
  const snapshot = snapshots[selectedPath];
  function invalidate() { setReview(null); setMessage(""); setError(""); }
  function fill(current: SequenceSnapshot) {
    setDraftRevision(current.revision);
    const sections = current.tracks.flatMap((t) => t.sections).filter((s) => s.dialogueId !== undefined);
    setRows([
      ...sections.map((s) => ({ key: s.path, sectionPath: s.path, dialogueId: String(s.dialogueId), start: String(s.start ?? ""), end: String(s.end ?? ""), selected: false })),
      ...current.voices.filter((v) => !sections.some((s) => s.dialogueId === v.id))
        .map((v) => ({ key: `voice-${v.id}`, dialogueId: String(v.id), start: "", end: "", selected: false })),
    ]);
    setMarkEnabled(false); setEventsEnabled(false);
    setSkipTime(String(current.marks.find((m) => m.label === "skip")?.seconds ?? ""));
    setShowTime(String(current.events.find((e) => e.role === "show")?.seconds ?? ""));
    setHideTime(String(current.events.find((e) => e.role === "hide")?.seconds ?? ""));
  }
  function select(path: string) {
    if (busy || path === selectedPath) return;
    if (selectedPath) drafts.current.set(selectedPath, { rows, markEnabled, skipTime, eventsEnabled, showTime, hideTime, revision: draftRevision });
    setSelectedPath(path); invalidate();
    const saved = drafts.current.get(path);
    if (saved) {
      setDraftRevision(saved.revision);
      setRows(saved.rows); setMarkEnabled(saved.markEnabled); setSkipTime(saved.skipTime);
      setEventsEnabled(saved.eventsEnabled); setShowTime(saved.showTime); setHideTime(saved.hideTime);
    } else if (snapshots[path]) fill(snapshots[path]);
    else { setRows([]); setDraftRevision(""); setMarkEnabled(false); setEventsEnabled(false); }
  }
  async function scanAll() {
    if (busy) return;
    invalidate(); setBusy("scan"); stopped.current = false;
    try {
      const assets = await animationRequest<Array<{ path: string; name: string }>>("catalog", { root });
      setCatalog(assets); setFailures({}); setProgress({ done: 0, total: assets.length });
      let first: SequenceSnapshot | undefined;
      for (let i = 0; i < assets.length && !stopped.current; i += 1) {
        const asset = assets[i];
        try {
          const result = await animationRequest<SequenceSnapshot>("scan", { assetPath: asset.path });
          setSnapshots((old) => ({ ...old, [asset.path]: result }));
          first ??= result;
        } catch (e) {
          setFailures((old) => ({ ...old, [asset.path]: e instanceof Error ? e.message : String(e) }));
        }
        setProgress({ done: i + 1, total: assets.length });
      }
      if (!selectedPath && first) { setSelectedPath(first.assetPath); fill(first); }
      setMessage(stopped.current ? "扫描已停止，已完成结果保留" : `扫描结束，共 ${assets.length} 个动画；失败项见左侧`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  async function refresh() {
    if (!selectedPath || busy) return;
    invalidate(); setBusy("refresh");
    try {
      const result = await animationRequest<SequenceSnapshot>("scan", { assetPath: selectedPath });
      setSnapshots((old) => ({ ...old, [selectedPath]: result }));
      setFailures((old) => { const next = { ...old }; delete next[selectedPath]; return next; });
      drafts.current.delete(selectedPath); fill(result);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  function patch() {
    if (!snapshot) throw new Error("请先扫描并选择动画");
    const chosen = rows.filter((r) => r.selected);
    if (chosen.some((r) => !r.dialogueId.trim() || !r.start.trim() || !r.end.trim()) ||
      (markEnabled && !skipTime.trim()) || (eventsEnabled && (!showTime.trim() || !hideTime.trim()))) throw new Error("请填写勾选项的 ID 和起止时间");
    const parsed = SequencePatchSchema.safeParse({
      assetPath: snapshot.assetPath, revision: draftRevision,
      subtitles: chosen.map((r) => ({ sectionPath: r.sectionPath, dialogueId: Number(r.dialogueId), start: Number(r.start), end: Number(r.end) })),
      skipTime: markEnabled ? Number(skipTime) : null,
      eventTimes: eventsEnabled ? { show: Number(showTime), hide: Number(hideTime) } : null,
    });
    if (!parsed.success) throw new Error("请检查字幕 ID 和时间，时间必须是有效数字");
    const problems = sequencePatchProblems(snapshot, parsed.data);
    if (problems.length) throw new Error(problems.join("\n"));
    return parsed.data;
  }
  async function prepare() {
    invalidate();
    try {
      const data = patch(); setBusy("review");
      setReview(await animationRequest<SequenceReview>("review", data));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  async function apply() {
    if (!review || busy) return;
    setBusy("apply"); setError("");
    try {
      const result = await animationRequest<{ applied: boolean; snapshot: SequenceSnapshot | null; message: string }>("apply", { token: review.token });
      setReview(null); setMessage(result.message);
      if (result.snapshot) {
        setSnapshots((old) => ({ ...old, [selectedPath]: result.snapshot! }));
        fill(result.snapshot); drafts.current.delete(selectedPath);
      } else setRows((old) => old.map((r) => ({ ...r, selected: false })));
    } catch (e) {
      setReview(null);
      setError(`${e instanceof Error ? e.message : String(e)}\n若发生连接中断或超时，请先在 UE 核对结果再重新扫描，勿直接重试。`);
    } finally { setBusy(""); }
  }
  return {
    root, setRoot, catalog, snapshots, failures, selectedPath, select, snapshot,
    rows, setRows, markEnabled, setMarkEnabled, skipTime, setSkipTime,
    eventsEnabled, setEventsEnabled, showTime, setShowTime, hideTime, setHideTime,
    review, setReview, busy, message, error, progress, invalidate,
    scanAll, refresh, prepare, apply, stop: () => { stopped.current = true; },
  };
}
