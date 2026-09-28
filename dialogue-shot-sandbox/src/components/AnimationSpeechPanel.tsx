import { AudioLines, Download, Play, RefreshCw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SequenceSnapshot } from "../animationVoice";
import type { useAnimationSpeech } from "../app/useAnimationSpeech";
import type { SubtitleRow } from "../app/useAnimationVoice";
import { AnimationSubtitleList } from "./AnimationSubtitleList";
import { TaskGlyph } from "./TaskMotion";
import type { TaskPhase } from "../taskFeedback";

export function AnimationSpeechPanel({
  speech,
  snapshot,
  rows,
  disabled,
  active,
  onRowsChange,
  onInvalidate,
  onAdopt,
}: {
  speech: ReturnType<typeof useAnimationSpeech>; snapshot: SequenceSnapshot; disabled: boolean;
  rows: SubtitleRow[];
  active: boolean;
  onRowsChange: (rows: SubtitleRow[]) => void;
  onInvalidate: () => void;
  onAdopt: (keys: string[]) => void;
}) {
  const s = speech.session;
  const player = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | undefined>(undefined);
  const playbackKey = useRef<string | undefined>(undefined);
  const [playing, setPlaying] = useState<string>();
  const running = s.job?.state === "running";
  const phase: TaskPhase = running && s.jobStatusUnknown ? "uncertain"
    : s.loading || running ? "running"
    : s.job?.state === "complete" ? "ready"
    : s.job?.state === "failed" ? "failed"
    : s.job?.state === "cancelled" ? "cancelled" : "idle";
  const locked = disabled || s.loading || running;
  const sections = snapshot.tracks.flatMap((t) => t.sections).filter((section) => section.active && section.audioEvent?.startsWith("A_Voice_"));
  useEffect(() => {
    if (!active) player.current?.pause();
  }, [active]);
  function stop() {
    stopAt.current = undefined; playbackKey.current = undefined; setPlaying(undefined);
  }
  function completeAudition() {
    if (playbackKey.current) speech.update({ auditioned: { ...s.auditioned, [playbackKey.current]: true } });
    stop(); player.current?.pause();
  }
  useEffect(() => { stop(); player.current?.pause(); }, [s.audio?.token, s.job?.id]);
  async function play(key: string, start: number, end: number) {
    if (!player.current) return;
    try {
      player.current.currentTime = start; stopAt.current = end;
      playbackKey.current = key; setPlaying(key);
      await player.current.play();
    } catch (e) { stop(); speech.update({ error: `试听失败：${String(e)}` }); }
  }
  return <section className="animation-speech" aria-label="语音识别与强制对齐">
    <div className="animation-voice__section-title">
      <h3><AudioLines size={16} />语音识别与对齐</h3>
      <div className="animation-speech__runtime">
        {speech.status?.installing && <TaskGlyph phase="running" runId="speech-install" active={active} />}
        <span className="animation-speech__status" role="status" title={speech.status?.root}>
          {speech.status?.reason || "正在检测端侧语音环境…"}
        </span>
        {speech.status && !speech.status.ready && !speech.status.installing && speech.status.canInstall !== false &&
          <button type="button" disabled={locked} title="下载依赖与两个 Qwen3 端侧模型到本机，不上传音频"
            onClick={() => void speech.install()}><Download size={14} />{speech.status.installError ? "重新安装" : "安装端侧模型"}</button>}
        <button type="button" title="重新检测端侧语音环境" aria-label="重新检测端侧语音环境"
          disabled={locked || speech.status?.installing} onClick={() => void speech.check()}><RefreshCw size={14} /></button>
      </div>
    </div>
    <div className="animation-speech__source">
      <label>语音事件
        <select aria-label="语音事件" value={s.sectionPath} disabled={locked} title={s.sectionPath} onChange={(e) => speech.edit({
          sectionPath: e.target.value, media: [], mediaId: "", audio: undefined, confirmed: false,
        })}>
          <option value="">选择当前动画的中文语音事件</option>
          {sections.map((section) => <option value={section.path} key={section.path}>{section.audioEvent} · {section.start?.toFixed(3)}s</option>)}
        </select>
      </label>
      <button type="button" disabled={locked || !s.sectionPath} onClick={() => void speech.loadMedia()}><RefreshCw size={14} />读取媒体</button>
      {s.media.length > 0 && <>
        <label>中文媒体<select aria-label="中文媒体" value={s.mediaId} disabled={locked} onChange={(e) => speech.edit({ mediaId: e.target.value, audio: undefined, confirmed: false })}>
          <option value="">请选择媒体</option>
          {s.media.map((media) => <option value={media.id} key={media.id}>{media.name} · {media.id}</option>)}
        </select></label>
        <button disabled={locked || !s.mediaId} onClick={() => void speech.prepareAudio()}><Download size={14} />提取语音</button>
      </>}
    </div>
    {!sections.length && <p className="animation-speech__status">当前动画没有可识别的 A_Voice 轨道；子序列需单独选择。</p>}
    {s.audio && <>
      <div className="animation-speech__audio">
        <audio ref={player} controls preload="metadata" src={s.audio.url} aria-label="源语音试听"
          onTimeUpdate={() => { if (player.current && stopAt.current !== undefined && player.current.currentTime >= stopAt.current) completeAudition(); }}
          onSeeked={() => { if (stopAt.current !== undefined && player.current && player.current.currentTime > stopAt.current) stop(); }}
          onPause={stop} onEnded={completeAudition}
          onError={() => speech.update({ error: "音频加载失败，请重新提取语音" })} />
        <span>源音频 {s.audio.duration.toFixed(3)} 秒 · CN · 媒体 {s.audio.mediaId}</span>
      </div>
      <div className="animation-speech__timing">
        <label>源音频裁剪 / 秒
          <input aria-label="语音裁剪开始" type="number" step=".001" value={s.cropStart} disabled={locked} onChange={(e) => speech.edit({ cropStart: e.target.value, confirmed: false })} />
          <span>至</span><input aria-label="语音裁剪结束" type="number" step=".001" value={s.cropEnd} disabled={locked} onChange={(e) => speech.edit({ cropEnd: e.target.value, confirmed: false })} />
        </label>
        <label title="最终字幕时间 = 源音频时间 + 此值；裁剪不改变源音频零点">源音频 0s 对应动画 / 秒
          <input aria-label="语音时间映射" type="number" step=".001" value={s.origin} disabled={locked} onChange={(e) => speech.edit({ origin: e.target.value, confirmed: false })} />
        </label>
        <label><input type="checkbox" checked={s.confirmed} disabled={locked} onChange={(e) => speech.edit({ confirmed: e.target.checked })} />已核对时间映射</label>
      </div>
      <div className="animation-speech__actions">
        <div role="group" aria-label="语音处理模式">
          <button type="button" aria-pressed={s.mode === "align"} disabled={locked} onClick={() => speech.edit({ mode: "align" })}>正式台词强制对齐</button>
          <button type="button" aria-pressed={s.mode === "asr"} disabled={locked} onClick={() => speech.edit({ mode: "asr" })}>语音转文字</button>
        </div>
        <span className="animation-speech__status">单次 ≤ 300 秒 · 仅本地处理</span>
        {running ? <button disabled={s.loading} onClick={() => void speech.cancel()}><Square size={14} />取消任务</button>
          : <button disabled={locked || !speech.status?.ready || !s.confirmed} onClick={() => void speech.start()}>
            <Play size={14} />{s.mode === "align" ? "开始对齐" : "开始识别"}
          </button>}
      </div>
    </>}
    {(s.loading || s.job) && <p role="status" className="animation-speech__task">
      <TaskGlyph phase={phase} runId={`${snapshot.assetPath}:${s.job?.id ?? "resources"}`} variant="signal" active={active} />
      <span>{s.loading ? s.loadingStage : s.jobStatusUnknown && running ? "任务状态待核对" : s.job?.stage}
        {s.job?.result && ` · ${s.job.result.device} · ${s.job.result.elapsed.toFixed(1)} 秒`}
      </span>
    </p>}
    {s.error && <p role="alert" className="animation-voice__error">{s.error}</p>}
    {s.job?.result?.warnings.map((warning) =>
      <p className="animation-speech__notice" role="note" key={warning}>{warning}</p>)}
    <AnimationSubtitleList
      speech={speech}
      snapshot={snapshot}
      rows={rows}
      disabled={disabled}
      locked={locked}
      active={active}
      playing={playing}
      onPlay={(line) => void play(line.key, line.audioStart, line.audioEnd)}
      onRowsChange={onRowsChange}
      onInvalidate={onInvalidate}
      onAdopt={onAdopt}
    />
  </section>;
}
