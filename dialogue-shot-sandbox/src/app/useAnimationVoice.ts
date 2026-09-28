import { useEffect, useRef, useState } from "react";
import type { TaskFeedback, TaskPhase } from "../taskFeedback";
import {
  SequencePatchSchema, sequencePatchProblems,
  type AnimationVoiceCache, type SequenceSnapshot, type SequenceReview,
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
  const [snapshotSources, setSnapshotSources] = useState<Record<string, {
    kind: "cache" | "live";
    cachedAt: string;
  }>>({});
  const [catalogCachedAt, setCatalogCachedAt] = useState<string | null>(null);
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
  const [task, setTask] = useState<TaskFeedback | null>(null);
  const [scanningPath, setScanningPath] = useState("");
  const [stopRequested, setStopRequested] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const stopped = useRef(false);
  const drafts = useRef(new Map<string, {
    rows: SubtitleRow[]; markEnabled: boolean; skipTime: string;
    eventsEnabled: boolean; showTime: string; hideTime: string; revision: string;
  }>());
  useEffect(() => () => { stopped.current = true; generation.current += 1; }, []);
  const snapshot = snapshots[selectedPath];
  function invalidate() { setReview(null); setMessage(""); setError(""); setTask(null); }
  function begin(action: TaskFeedback["action"]) {
    if (pending.current) return null;
    pending.current = true;
    const id = ++generation.current;
    invalidate(); setBusy(action); setTask({ id, action, phase: "running" });
    return id;
  }
  function outcome(id: number, phase: TaskPhase) {
    if (generation.current === id) setTask((old) => old?.id === id ? { ...old, phase } : old);
  }
  function finish(id: number) {
    if (generation.current !== id) return;
    pending.current = false; setBusy(""); setScanningPath("");
  }
  function hydrateCache(cache: AnimationVoiceCache, useCachedCatalog: boolean) {
    const cachedSnapshots = Object.fromEntries(
      Object.entries(cache.snapshots).map(([path, entry]) => [path, entry.snapshot]),
    );
    const cachedSources = Object.fromEntries(
      Object.entries(cache.snapshots).map(([path, entry]) => [
        path,
        { kind: "cache" as const, cachedAt: entry.cachedAt },
      ]),
    );
    if (useCachedCatalog) setCatalog(cache.catalog);
    setCatalogCachedAt(cache.catalogCachedAt);
    setSnapshots((old) => ({ ...cachedSnapshots, ...old }));
    setSnapshotSources((old) => ({ ...cachedSources, ...old }));
    if (!selectedPath) {
      const first = cache.catalog.find((asset) => cachedSnapshots[asset.path]);
      if (first) {
        setSelectedPath(first.path);
        fill(cachedSnapshots[first.path]);
      }
    }
  }
  useEffect(() => {
    let disposed = false;
    void animationRequest<AnimationVoiceCache>("cache", { root }).then((cache) => {
      if (!disposed && cache.catalog.length > 0) hydrateCache(cache, true);
    }).catch(() => undefined);
    return () => { disposed = true; };
  // Restore only the default root. Edited paths are loaded explicitly to avoid requests while typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  function changeRoot(value: string) {
    setRoot(value);
    setCatalog([]);
    setSnapshots({});
    setSnapshotSources({});
    setCatalogCachedAt(null);
    setSelectedPath("");
    setRows([]);
    setDraftRevision("");
    setMarkEnabled(false);
    setEventsEnabled(false);
    setProgress({ done: 0, total: 0 });
    invalidate();
  }
  async function loadCatalog() {
    const id = begin("catalog");
    if (id === null) return;
    stopped.current = false;
    let cached: AnimationVoiceCache | undefined;
    try {
      cached = await animationRequest<AnimationVoiceCache>("cache", { root });
      if (cached.catalog.length > 0) hydrateCache(cached, true);
      const assets = await animationRequest<Array<{ path: string; name: string }>>("catalog", { root });
      setCatalog(assets);
      setCatalogCachedAt(new Date().toISOString());
      setProgress({ done: 0, total: assets.length });
      const cachedCount = assets.filter((asset) => Boolean(cached?.snapshots[asset.path] || snapshots[asset.path])).length;
      setMessage(`已读取 ${assets.length} 个动画；${cachedCount} 个可直接使用本地缓存`);
      outcome(id, "success");
    } catch (e) {
      outcome(id, "failed");
      if (cached?.catalog.length) {
        const reason = e instanceof Error ? e.message : String(e);
        setError(`UE 列表读取失败：${reason}\n已显示 ${cached.catalog.length} 个本地缓存项，可继续查看或稍后重试。`);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally { finish(id); }
  }
  async function scanAll() {
    if (pending.current) return;
    if (!catalog.length) {
      setError("请先读取动画列表，再扫描配置");
      return;
    }
    const id = begin("scan");
    if (id === null) return;
    stopped.current = false; setStopRequested(false);
    try {
      const assets = catalog;
      setFailures({}); setProgress({ done: 0, total: assets.length });
      let first: SequenceSnapshot | undefined;
      let done = 0, failed = 0;
      for (let i = 0; i < assets.length && !stopped.current; i += 1) {
        const asset = assets[i];
        setScanningPath(asset.path);
        try {
          const result = await animationRequest<SequenceSnapshot>("scan", { assetPath: asset.path, root });
          setSnapshots((old) => ({ ...old, [asset.path]: result }));
          setSnapshotSources((old) => ({
            ...old,
            [asset.path]: { kind: "live", cachedAt: new Date().toISOString() },
          }));
          first ??= result;
        } catch (e) {
          failed += 1;
          setFailures((old) => ({ ...old, [asset.path]: e instanceof Error ? e.message : String(e) }));
        }
        done = i + 1;
        setProgress({ done: i + 1, total: assets.length });
      }
      if (!selectedPath && first) { setSelectedPath(first.assetPath); fill(first); }
      const cancelled = stopped.current && done < assets.length;
      setMessage(`${cancelled ? "扫描已停止" : "配置扫描完成"} · 已处理 ${done}/${assets.length} · ${done - failed} 个已缓存${failed ? ` · ${failed} 个失败，见左侧` : ""}`);
      outcome(id, cancelled ? "cancelled" : failed ? "warning" : "success");
    } catch (e) { outcome(id, "failed"); setError(e instanceof Error ? e.message : String(e)); }
    finally { finish(id); }
  }
  async function refresh() {
    if (!selectedPath) return;
    const id = begin("refresh");
    if (id === null) return;
    try {
      const result = await animationRequest<SequenceSnapshot>("scan", { assetPath: selectedPath, root });
      setSnapshots((old) => ({ ...old, [selectedPath]: result }));
      setSnapshotSources((old) => ({
        ...old,
        [selectedPath]: { kind: "live", cachedAt: new Date().toISOString() },
      }));
      setFailures((old) => { const next = { ...old }; delete next[selectedPath]; return next; });
      drafts.current.delete(selectedPath); fill(result);
      setMessage("已从 UE 重新读取当前动画"); outcome(id, "success");
    } catch (e) { outcome(id, "failed"); setError(e instanceof Error ? e.message : String(e)); }
    finally { finish(id); }
  }
  function patch() {
    if (!snapshot) throw new Error("请先扫描并选择动画");
    const chosen = rows.filter((r) => r.selected);
    if (chosen.some((r) => !r.dialogueId.trim() || !r.start.trim() || !r.end.trim()) ||
      (markEnabled && !skipTime.trim()) || (eventsEnabled && (!showTime.trim() || !hideTime.trim()))) throw new Error("请填写勾选项的 ID 和起止时间");
    const parsed = SequencePatchSchema.safeParse({
      assetPath: snapshot.assetPath, revision: draftRevision,
      subtitles: chosen.map((r) => ({ sectionPath: r.sectionPath, dialogueId: Number(r.dialogueId), start: Number(r.start), end: Number(r.end), speechText: r.speechText })),
      skipTime: markEnabled ? Number(skipTime) : null,
      eventTimes: eventsEnabled ? { show: Number(showTime), hide: Number(hideTime) } : null,
    });
    if (!parsed.success) throw new Error("请检查字幕 ID 和时间，时间必须是有效数字");
    const problems = sequencePatchProblems(snapshot, parsed.data);
    if (problems.length) throw new Error(problems.join("\n"));
    return parsed.data;
  }
  async function prepare() {
    const id = begin("review");
    if (id === null) return;
    try {
      const data = patch();
      setReview(await animationRequest<SequenceReview>("review", data));
      setMessage("差异已就绪，等待确认写入"); outcome(id, "ready");
    } catch (e) { outcome(id, "failed"); setError(e instanceof Error ? e.message : String(e)); }
    finally { finish(id); }
  }
  async function apply() {
    if (!review || pending.current) return;
    // Retain the reviewed changes while writing; begin clears only stale feedback here.
    const approved = review;
    const id = begin("apply");
    if (id === null) return;
    setReview(approved);
    try {
      const result = await animationRequest<{ applied: boolean; snapshot: SequenceSnapshot | null; message: string }>("apply", { token: approved.token });
      setReview(null); setMessage(result.message);
      outcome(id, result.applied && result.snapshot ? "success" : "uncertain");
      if (result.snapshot) {
        setSnapshots((old) => ({ ...old, [selectedPath]: result.snapshot! }));
        fill(result.snapshot); drafts.current.delete(selectedPath);
      } else setRows((old) => old.map((r) => ({ ...r, selected: false })));
    } catch (e) {
      outcome(id, "uncertain");
      setReview(null);
      setError(`${e instanceof Error ? e.message : String(e)}\n若发生连接中断或超时，请先在 UE 核对结果再重新扫描，勿直接重试。`);
    } finally { finish(id); }
  }
  return {
    root, setRoot: changeRoot, catalog, catalogCachedAt, snapshots, snapshotSources,
    failures, selectedPath, select, snapshot,
    rows, setRows, markEnabled, setMarkEnabled, skipTime, setSkipTime,
    eventsEnabled, setEventsEnabled, showTime, setShowTime, hideTime, setHideTime,
    review, busy, message, error, progress, task, scanningPath, stopRequested, invalidate,
    loadCatalog, scanAll, refresh, prepare, apply, stop: () => { stopped.current = true; setStopRequested(true); },
  };
}
