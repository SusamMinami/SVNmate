import { AudioLines, ArrowDown, ArrowUp, Check, Download, Play, RefreshCw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SequenceSnapshot } from "../animationVoice";
import type { useAnimationSpeech } from "../app/useAnimationSpeech";

export function AnimationSpeechPanel({ speech, snapshot, disabled, active, onAdopt }: {
  speech: ReturnType<typeof useAnimationSpeech>; snapshot: SequenceSnapshot; disabled: boolean;
  active: boolean; onAdopt: () => void;
}) {
  const s = speech.session;
  const player = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | undefined>(undefined);
  const playbackKey = useRef<string | undefined>(undefined);
  const [playing, setPlaying] = useState<string>();
  const running = s.job?.state === "running";
  const locked = disabled || s.loading || running;
  const sections = snapshot.tracks.flatMap((t) => t.sections).filter((section) => section.active && section.audioEvent?.startsWith("A_Voice_"));
  useEffect(() => {
    if (!active) player.current?.pause();
  }, [active]);
  const pending = s.job?.result?.lines.filter((line) => !s.adoptedKeys[line.key]) ?? [];
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
  function reorder(index: number, delta: number) {
    const reference = [...s.reference];
    [reference[index], reference[index + delta]] = [reference[index + delta], reference[index]];
    speech.edit({ reference });
  }
  return <section className="animation-speech" aria-label="语音识别与强制对齐">
    <div className="animation-voice__section-title">
      <h3><AudioLines size={16} />语音识别与对齐</h3>
      <span className="animation-speech__status" role="status">{speech.status?.reason || "本地模型状态未检测"}</span>
      <button type="button" title="检测本地语音模型" aria-label="检测本地语音模型" disabled={locked} onClick={() => void speech.check()}><RefreshCw size={14} /></button>
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
      {s.mode === "align" && <details className="animation-speech__reference">
        <summary>对齐台词顺序 · {s.reference.filter((line) => line.selected).length} 条已选</summary>
        {s.reference.length === 0 && <p>未匹配到正式台词，可先使用语音转文字。</p>}
        {s.reference.map((line, index) => <div key={line.key}>
          <input type="checkbox" aria-label={`对齐台词 ${index + 1}`} disabled={locked} checked={line.selected}
            onChange={(e) => speech.edit({ reference: s.reference.map((l) => l.key === line.key ? { ...l, selected: e.target.checked } : l) })} />
          <code>{line.dialogueId}</code><span>{line.text}</span>
          <button title="上移台词" aria-label={`上移台词 ${index + 1}`} disabled={locked || index === 0} onClick={() => reorder(index, -1)}><ArrowUp size={13} /></button>
          <button title="下移台词" aria-label={`下移台词 ${index + 1}`} disabled={locked || index === s.reference.length - 1} onClick={() => reorder(index, 1)}><ArrowDown size={13} /></button>
        </div>)}
      </details>}
    </>}
    {(s.loading || s.job) && <p role="status">{s.loading ? "正在读取本地语音资源…" : s.job?.stage}
      {s.job?.result && ` · ${s.job.result.device} · ${s.job.result.elapsed.toFixed(1)} 秒`}
    </p>}
    {s.error && <p role="alert" className="animation-voice__error">{s.error}</p>}
    {s.job?.result && <div className="animation-speech__result" aria-label="语音分析结果">
      {s.job.result.warnings.map((warning) => <p className="animation-voice__warning" key={warning}>{warning}</p>)}
      <table><thead><tr>
        <th><input type="checkbox" aria-label="选择全部语音结果" disabled={disabled || !pending.length}
          checked={pending.length > 0 && pending.every((line) => s.chosen[line.key])}
          onChange={(e) => speech.update({ chosen: Object.fromEntries(pending.map((line) => [line.key, e.target.checked])) })} /></th>
        <th>台词 / ID</th><th>动画起止 / 秒</th><th>复核</th><th />
      </tr></thead><tbody>{s.job.result.lines.map((line, index) => <tr key={line.key}>
        <td><input type="checkbox" aria-label={`选择语音结果 ${index + 1}`} disabled={disabled || s.adoptedKeys[line.key]} checked={s.chosen[line.key] || Boolean(s.adoptedKeys[line.key])}
          onChange={(e) => speech.update({ chosen: { ...s.chosen, [line.key]: e.target.checked } })} /></td>
        <td><small>{line.dialogueId || "识别草稿 · 待关联配音 ID"}</small><span>{line.text}</span></td>
        <td>{line.start.toFixed(3)} – {line.end.toFixed(3)}</td>
        <td>
          <span role="status">{playing === line.key ? "试听中" : s.auditioned[line.key] ? "已试听" : "待试听"}{s.adoptedKeys[line.key] ? " · 已采用" : ""}</span>
          {line.warnings.length > 0 && <span className="animation-voice__warning">{line.warnings.join("；")}</span>}
        </td>
        <td><button title="试听本句" aria-label={`试听语音结果 ${index + 1}`} onClick={() => void play(line.key, line.audioStart, line.audioEnd)}><Play size={14} /></button></td>
      </tr>)}</tbody></table>
      <button disabled={disabled || !pending.some((line) => s.chosen[line.key])} onClick={onAdopt}>
        <Check size={14} />{pending.length ? "采用所选时间到草稿" : "已加入字幕草稿"}
      </button>
    </div>}
  </section>;
}
