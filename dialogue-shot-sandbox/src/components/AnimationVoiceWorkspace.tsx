import { Check, FileSearch, Plus, RefreshCw, Square, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useAnimationVoice } from "../app/useAnimationVoice";
import { useAnimationSpeech } from "../app/useAnimationSpeech";
import { AnimationSpeechPanel } from "./AnimationSpeechPanel";
import "./animationVoice.css";

export function AnimationVoiceWorkspace({ active = true }: { active?: boolean }) {
  const vm = useAnimationVoice();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"subtitles" | "configuration">("subtitles");
  const current = vm.snapshot;
  const speech = useAnimationSpeech(current, vm.rows, active);
  const disabled = Boolean(vm.busy);
  const assets = vm.catalog.filter((a) => a.path.toLowerCase().includes(query.toLowerCase()));
  const time = (value: number | null) => value === null ? "无界" : `${value.toFixed(3)}s`;
  return <div className="animation-voice">
    <div className="animation-voice__toolbar">
      <label className="animation-voice__root">动画目录
        <input aria-label="动画目录" value={vm.root} disabled={disabled}
          onChange={(e) => { vm.setRoot(e.target.value); vm.invalidate(); }} />
      </label>
      <button type="button" disabled={disabled} onClick={() => void vm.scanAll()}>
        <FileSearch size={15} />全量扫描
      </button>
      {vm.busy === "scan" && <button type="button" onClick={vm.stop} title="停止后续扫描" aria-label="停止后续扫描"><Square size={15} /></button>}
      <span role="status">{vm.busy === "scan" ? `${vm.progress.done} / ${vm.progress.total}` : `${vm.catalog.length} 个动画`}</span>
    </div>
    <div className="animation-voice__body">
      <aside className="animation-voice__catalog" aria-label="动画列表">
        <input aria-label="筛选动画" placeholder="筛选动画名称或路径" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="animation-voice__asset-list">
          {assets.map((asset) => <button key={asset.path} type="button" disabled={disabled}
            aria-pressed={vm.selectedPath === asset.path} title={vm.failures[asset.path] || asset.path}
            onClick={() => vm.select(asset.path)}>
            <span>{asset.name}</span>
            <small className={vm.failures[asset.path] ? "animation-voice__error" : ""}>
              {vm.failures[asset.path] ? "扫描失败" : vm.snapshots[asset.path]
                ? `${vm.snapshots[asset.path].tracks.length} 轨 · ${vm.snapshots[asset.path].skipBlockedReasons.length ? "跳过待配置" : "端点已识别"}`
                : "未扫描"}
            </small>
          </button>)}
          {!assets.length && <p className="animation-voice__empty">{vm.catalog.length ? "没有匹配的动画" : "尚无扫描结果"}</p>}
        </div>
      </aside>
      <main className="animation-voice__detail">
        {current ? <>
          <div className="animation-voice__identity">
            <div><h2 title={current.assetPath}>{current.name}</h2>
              <span>{time(current.start)} – {time(current.end)} · {current.displayRate} fps · {current.dirty ? "UE 未保存" : "UE 已保存"}</span>
            </div>
            <button type="button" disabled={disabled} title="重新读取当前动画并重置其草稿" aria-label="重新读取当前动画"
              onClick={() => void vm.refresh()}><RefreshCw size={16} /></button>
          </div>
          <div className="animation-voice__tabs" role="tablist" aria-label="动画配置页签">
            <button role="tab" aria-selected={tab === "subtitles"} onClick={() => setTab("subtitles")}>字幕时间</button>
            <button role="tab" aria-selected={tab === "configuration"} onClick={() => setTab("configuration")}>配置检查 · {current.tracks.length} 轨</button>
          </div>
          <div className="animation-voice__scroll">
            {current.warnings.map((w) => <p key={w} className="animation-voice__warning">{w}</p>)}
            <div hidden={tab !== "subtitles"}>
              <AnimationSpeechPanel speech={speech} snapshot={current} disabled={disabled} active={active && tab === "subtitles"}
                onAdopt={() => {
                  try {
                    const adopted = speech.adoptedRows();
                    vm.invalidate(); vm.setRows(adopted.rows);
                    speech.update({
                      adoptedKeys: adopted.adoptedKeys, targetKeys: adopted.targetKeys,
                      submittedRows: JSON.stringify(adopted.rows), chosen: {}, error: "",
                    });
                  } catch (e) { speech.update({ error: e instanceof Error ? e.message : String(e) }); }
                }} />
            </div>
            {tab === "subtitles" ? <>
              <div className="animation-voice__section-title"><h3>字幕段</h3>
                <button type="button" disabled={disabled} title="添加字幕段" aria-label="添加字幕段" onClick={() => {
                  vm.invalidate(); vm.setRows([...vm.rows, { key: crypto.randomUUID(), dialogueId: "", start: "", end: "", selected: true }]);
                }}><Plus size={15} /></button>
              </div>
              <table className="animation-voice__subtitles">
                <thead><tr><th><input type="checkbox" aria-label="选择全部字幕" disabled={disabled || !vm.rows.length}
                  checked={vm.rows.length > 0 && vm.rows.every((r) => r.selected)}
                  onChange={(e) => { vm.invalidate(); vm.setRows(vm.rows.map((r) => ({ ...r, selected: e.target.checked }))); }} /></th>
                  <th>Dialogue ID</th><th>角色 / 正式台词</th><th>开始 / 秒</th><th>结束 / 秒</th><th>时长</th><th /></tr></thead>
                <tbody>{vm.rows.map((row, index) => {
                  const voice = current.voices.find((v) => String(v.id) === row.dialogueId);
                  const update = (field: "dialogueId" | "start" | "end", value: string) => {
                    vm.invalidate(); vm.setRows(vm.rows.map((r) => r.key === row.key ? { ...r, [field]: value, selected: true } : r));
                  };
                  return <tr key={row.key} data-selected={row.selected}>
                    <td><input type="checkbox" aria-label={`选择字幕 ${index + 1}`} checked={row.selected} disabled={disabled}
                      onChange={(e) => { vm.invalidate(); vm.setRows(vm.rows.map((r) => r.key === row.key ? { ...r, selected: e.target.checked } : r)); }} /></td>
                    <td><input aria-label={`字幕 ${index + 1} ID`} value={row.dialogueId} disabled={disabled} onChange={(e) => update("dialogueId", e.target.value)} /></td>
                    <td><small>{voice?.name || (row.sectionPath ? "UE 已有字幕" : "新增字幕")}{row.timeSource ? ` · ${row.timeSource}` : ""}</small>
                      <span>{voice?.text || row.speechText || "配音表未匹配"}</span>
                      {row.speechText && !voice && <small className="animation-voice__warning">{row.dialogueId ? "配音 ID 待审核校验" : "待填写有效配音 ID"}；识别文字不写入配音表</small>}
                    </td>
                    <td><input type="number" step="0.001" aria-label={`字幕 ${index + 1} 开始`} value={row.start} disabled={disabled} onChange={(e) => update("start", e.target.value)} /></td>
                    <td><input type="number" step="0.001" aria-label={`字幕 ${index + 1} 结束`} value={row.end} disabled={disabled} onChange={(e) => update("end", e.target.value)} /></td>
                    <td>{row.start && row.end ? `${(Number(row.end) - Number(row.start)).toFixed(3)}s` : "待定"}</td>
                    <td>{!row.sectionPath && <button type="button" disabled={disabled} title="移除新增字幕" aria-label={`移除新增字幕 ${index + 1}`}
                      onClick={() => { vm.invalidate(); vm.setRows(vm.rows.filter((r) => r.key !== row.key)); }}><Trash2 size={14} /></button>}</td>
                  </tr>;
                })}</tbody>
              </table>
              {!vm.rows.length && <p className="animation-voice__empty">尚无字幕段或匹配的配音表台词</p>}
            </> : <>
              {current.tracks.map((track) => <details className="animation-voice__track" key={track.path}>
                <summary>{track.name} <small>{track.className} · {track.sections.length} 段{track.binding ? ` · ${track.binding}` : ""}</small></summary>
                {track.sections.map((section) => <div key={section.path} title={section.path}>
                  <span>{section.className}{section.active ? "" : " · 已禁用"}</span>
                  <span>{time(section.start)} – {time(section.end)}</span>
                  <code>{section.audioEvent || section.subSequence || (section.dialogueId ? `DialogueID: ${section.dialogueId}` : "")}</code>
                </div>)}
              </details>)}
              <h3>事件键</h3>
              {current.events.map((event) => <p className="animation-voice__event" key={`${event.sectionPath}:${event.channel}:${event.key}`}>
                <span>{time(event.seconds)} · {event.role}</span><code>{event.endpoint || "端点未识别"}</code>
              </p>)}
              <h3>标记</h3>
              {current.marks.map((mark, i) => <p key={i}>{mark.label} · {time(mark.seconds)}</p>)}
            </>}
            <section className="animation-voice__skip">
              <h3>跳过配置</h3>
              <p title={current.director.path}>Director：{current.director.path ? "已存在" : "缺失"}</p>
              {current.skipBlockedReasons.map((reason) => <p className="animation-voice__warning" key={reason}>{reason}</p>)}
              <div className="animation-voice__controls">
                <label><input type="checkbox" checked={vm.markEnabled} disabled={disabled}
                  onChange={(e) => { vm.invalidate(); vm.setMarkEnabled(e.target.checked); }} />写入 skip 标记</label>
                <input aria-label="skip 标记时间" type="number" step="0.001" value={vm.skipTime} disabled={disabled || !vm.markEnabled}
                  onChange={(e) => { vm.invalidate(); vm.setSkipTime(e.target.value); }} /><span>秒</span>
              </div>
              <div className="animation-voice__controls">
                <label><input type="checkbox" checked={vm.eventsEnabled} disabled={disabled || current.skipBlockedReasons.length > 0}
                  onChange={(e) => { vm.invalidate(); vm.setEventsEnabled(e.target.checked); }} />校正已有事件</label>
                <label>显示 <input aria-label="显示跳过按钮时间" type="number" step="0.001" value={vm.showTime} disabled={disabled || !vm.eventsEnabled || current.skipBlockedReasons.length > 0}
                  onChange={(e) => { vm.invalidate(); vm.setShowTime(e.target.value); }} /></label>
                <label>隐藏 <input aria-label="隐藏跳过按钮时间" type="number" step="0.001" value={vm.hideTime} disabled={disabled || !vm.eventsEnabled || current.skipBlockedReasons.length > 0}
                  onChange={(e) => { vm.invalidate(); vm.setHideTime(e.target.value); }} /></label>
              </div>
            </section>
          </div>
        </> : <div className="animation-voice__empty"><FileSearch size={32} /><h2>等待动画配置</h2>
          <p>{vm.failures[vm.selectedPath] || "尚未选择已扫描的 LevelSequence"}</p>
          {vm.selectedPath && <button disabled={disabled} onClick={() => void vm.refresh()}>重新扫描当前动画</button>}
        </div>}
        {vm.review && <div className="animation-voice__review" aria-label="写入差异">
          <strong>确认写入 · 仅当前动画 · 不自动保存</strong>
          <ul>{vm.review.changes.map((change, i) => <li key={i}>{change}</li>)}</ul>
        </div>}
        <footer className="animation-voice__footer">
          <div role={vm.error ? "alert" : "status"} className={vm.error ? "animation-voice__error" : ""}>
            {vm.error || vm.message || (vm.busy ? "正在读取与校验 UE 配置…" : "未选择的配置保持不变")}
          </div>
          {vm.review && <button type="button" disabled={disabled} title="取消审核" aria-label="取消审核" onClick={() => vm.setReview(null)}><X size={15} /></button>}
          <button className="primary-button" type="button" disabled={disabled || !current}
            onClick={() => void (vm.review ? vm.apply() : vm.prepare())}>
            <Check size={15} />{vm.busy === "apply" ? "写入中…" : vm.busy === "review" ? "检查中…" : vm.review ? "确认写入 UE" : "检查写入差异"}
          </button>
        </footer>
      </main>
    </div>
  </div>;
}
