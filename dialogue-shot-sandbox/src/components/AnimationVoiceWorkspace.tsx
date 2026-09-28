import { FileSearch, RefreshCw, Square, X } from "lucide-react";
import { useState } from "react";
import { useAnimationVoice } from "../app/useAnimationVoice";
import { useAnimationSpeech } from "../app/useAnimationSpeech";
import { AnimationSpeechPanel } from "./AnimationSpeechPanel";
import { TaskGlyph, TaskMotionScope, TaskProgress } from "./TaskMotion";
import "./animationVoice.css";

export function AnimationVoiceWorkspace({ active = true }: { active?: boolean }) {
  const vm = useAnimationVoice();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"subtitles" | "configuration">("subtitles");
  const current = vm.snapshot;
  const speech = useAnimationSpeech(current, vm.rows, active);
  const disabled = Boolean(vm.busy);
  const assets = vm.catalog.filter((a) => a.path.toLowerCase().includes(query.toLowerCase()));
  const loadedCount = vm.catalog.filter((asset) => Boolean(vm.snapshots[asset.path])).length;
  const currentSource = current ? vm.snapshotSources[current.assetPath] : undefined;
  const showEvents = current?.events.filter((event) => event.role === "show") ?? [];
  const hideEvents = current?.events.filter((event) => event.role === "hide") ?? [];
  const subtitleWriteCount = vm.rows.filter((row) => row.selected).length;
  const writeCount = subtitleWriteCount + Number(vm.markEnabled) + Number(vm.eventsEnabled);
  const writingTask = vm.task?.action === "review" || vm.task?.action === "apply" ? vm.task : null;
  const busyLabel = vm.busy === "scan"
    ? `${vm.stopRequested ? "等待当前项结束后停止" : "正在扫描"} · 已处理 ${vm.progress.done}/${vm.progress.total}`
    : vm.busy === "catalog" ? "正在读取动画列表…"
    : vm.busy === "refresh" ? "正在重新读取当前动画…"
    : vm.busy === "apply" ? "正在写入并回读 UE，尚未保存…"
    : "正在检查写入差异…";
  const time = (value: number | null) => value === null ? "无界" : `${value.toFixed(3)}s`;
  const cachedTime = (value: string) => new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
  return <TaskMotionScope active={active}><div className="animation-voice">
    <div className="animation-voice__body">
      <aside className="animation-voice__catalog" aria-label="动画列表">
        <div className="animation-voice__catalog-head">
          <div className="animation-voice__catalog-controls">
            <label className="animation-voice__root"><span>动画目录</span>
              <input aria-label="动画目录" value={vm.root} disabled={disabled}
                onChange={(e) => { vm.setRoot(e.target.value); vm.invalidate(); }} />
            </label>
            <button type="button" disabled={disabled} title={vm.busy === "catalog" ? "正在读取动画列表" : "读取动画列表"}
              aria-label="读取列表" aria-busy={vm.busy === "catalog"} onClick={() => void vm.loadCatalog()}>
              {vm.task?.action === "catalog" ? <TaskGlyph phase={vm.task.phase} runId={vm.task.id} /> : <FileSearch size={15} />}
            </button>
            <button type="button" disabled={disabled || !vm.catalog.length} title="扫描全部动画配置"
              aria-label="扫描配置" aria-busy={vm.busy === "scan"} onClick={() => void vm.scanAll()}>
              {vm.task?.action === "scan" ? <TaskGlyph phase={vm.task.phase} runId={vm.task.id} /> : <RefreshCw size={15} />}
            </button>
            {vm.busy === "scan" && <button type="button" disabled={vm.stopRequested} onClick={vm.stop} title="停止后续扫描" aria-label="停止后续扫描"><Square size={15} /></button>}
          </div>
          <div className="animation-voice__catalog-filter">
            <input aria-label="筛选动画" placeholder="筛选名称或路径" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span role="status" title={`${vm.catalog.length} 个动画，${loadedCount} 个已有结果`}>
              {vm.busy === "scan" ? `${vm.progress.done}/${vm.progress.total}` : `${vm.catalog.length} 个 · ${loadedCount} 已读`}
            </span>
          </div>
          {vm.task?.action === "scan" && <TaskProgress {...vm.progress} phase={vm.task.phase} />}
        </div>
        <div className="animation-voice__asset-list">
          {assets.map((asset) => <button key={asset.path} type="button" disabled={disabled}
            aria-pressed={vm.selectedPath === asset.path} title={vm.failures[asset.path] || asset.path}
            onClick={() => vm.select(asset.path)}>
            <span>{asset.name}</span>
            <small className={vm.failures[asset.path] ? "animation-voice__error" : ""}>
              {vm.scanningPath === asset.path ? "正在读取配置…" : vm.failures[asset.path] ? "读取失败" : vm.snapshots[asset.path]
                ? `${vm.snapshotSources[asset.path]?.kind === "cache" ? "本地缓存" : "已读取"} · ${vm.snapshots[asset.path].tracks.length} 轨 · ${vm.snapshots[asset.path].skipBlockedReasons.length ? "跳过待检查" : "端点已识别"}`
                : "待读取"}
            </small>
          </button>)}
          {!assets.length && <p className="animation-voice__empty">{vm.catalog.length ? "没有匹配的动画" : "尚未读取动画列表"}</p>}
        </div>
      </aside>
      <main className="animation-voice__detail">
        {current ? <div className="animation-voice__scroll">
          <div className="animation-voice__identity">
            <div>
              <h2 title={current.assetPath}>{current.name}</h2>
              <span>{time(current.start)} – {time(current.end)} · {current.displayRate} fps · {current.dirty ? "UE 未保存" : "UE 已保存"}</span>
              {currentSource?.kind === "cache" && <small title={currentSource.cachedAt}>本地缓存 · {cachedTime(currentSource.cachedAt)} · 写入前会重新核对 UE</small>}
            </div>
            <button type="button" disabled={disabled} title="从 UE 重新读取当前动画，并覆盖该动画的缓存与草稿" aria-label="从 UE 重新读取当前动画"
              aria-busy={vm.busy === "refresh"} onClick={() => void vm.refresh()}>
              {vm.task?.action === "refresh" ? <TaskGlyph phase={vm.task.phase} runId={vm.task.id} /> : <RefreshCw size={16} />}
            </button>
          </div>
          <div className="animation-voice__tabs" role="tablist" aria-label="动画配置页签">
            <button role="tab" aria-selected={tab === "subtitles"} onClick={() => setTab("subtitles")}>字幕时间</button>
            <button role="tab" aria-selected={tab === "configuration"} onClick={() => setTab("configuration")}>配置检查 · {current.tracks.length} 轨</button>
          </div>
          <div className="animation-voice__content">
            {current.warnings.map((w) => <p key={w} className="animation-voice__warning">{w}</p>)}
            <div hidden={tab !== "subtitles"}>
              <AnimationSpeechPanel speech={speech} snapshot={current} rows={vm.rows} disabled={disabled}
                active={active && tab === "subtitles"} onRowsChange={vm.setRows} onInvalidate={vm.invalidate}
                onAdopt={(keys) => {
                  try {
                    const adopted = speech.adoptedRows(keys);
                    vm.invalidate(); vm.setRows(adopted.rows);
                    speech.update({
                      adoptedKeys: adopted.adoptedKeys, adoptedTargets: adopted.adoptedTargets,
                      submittedRows: adopted.submittedRows, error: "",
                    });
                  } catch (e) { speech.update({ error: e instanceof Error ? e.message : String(e) }); }
                }} />
            </div>
            {tab === "configuration" && <>
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
                <span>{time(event.seconds)} · {event.role}</span>
                <code>{event.endpoint || "端点未识别"}{event.endpointFunction ? ` · ${event.endpointFunction}` : ""}</code>
              </p>)}
              <h3>标记</h3>
              {current.marks.map((mark, i) => <p key={i}>{mark.label} · {time(mark.seconds)}</p>)}
            </>}
            <section className="animation-voice__skip">
              <h3>跳过配置</h3>
              <dl className="animation-voice__skip-status">
                <div><dt>Director Blueprint</dt><dd title={current.director.path}>
                  {current.director.path ? "已找到" : "未找到"}
                </dd></div>
                <div><dt>显示端点</dt><dd>{showEvents.length === 1 ? `已识别 · ${time(showEvents[0].seconds)}` : showEvents.length ? `${showEvents.length} 个，需在 UE 处理` : "未识别"}</dd></div>
                <div><dt>隐藏端点</dt><dd>{hideEvents.length === 1 ? `已识别 · ${time(hideEvents[0].seconds)}` : hideEvents.length ? `${hideEvents.length} 个，需在 UE 处理` : "未识别"}</dd></div>
              </dl>
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
        </div> : <div className="animation-voice__empty"><FileSearch size={32} /><h2>等待动画配置</h2>
          <p>{vm.failures[vm.selectedPath] || (vm.selectedPath ? "当前动画尚未读取配置" : "先读取列表，再选择动画或扫描全部配置")}</p>
          {vm.selectedPath && <button disabled={disabled} aria-busy={vm.busy === "refresh"} onClick={() => void vm.refresh()}>
            {vm.task?.action === "refresh" && <TaskGlyph phase={vm.task.phase} runId={vm.task.id} />}读取当前动画
          </button>}
        </div>}
        {vm.review && <div className="animation-voice__review" aria-label="写入差异">
          <strong>确认写入 · 仅当前动画 · 不自动保存</strong>
          <ul>{vm.review.changes.map((change, i) => <li key={i}>{change}</li>)}</ul>
        </div>}
        <footer className="animation-voice__footer">
          <div role={vm.error ? "alert" : "status"} className={vm.error ? "animation-voice__error" : ""}>
            {vm.task?.phase === "uncertain" && "待核对 · "}
            {vm.error || vm.message || (vm.busy
              ? busyLabel
              : writeCount > 0 ? `${subtitleWriteCount} 条字幕 · ${writeCount} 项待检查` : "0 项待写入")}
          </div>
          {vm.review && <button type="button" disabled={disabled} title="取消审核" aria-label="取消审核" onClick={vm.invalidate}><X size={15} /></button>}
          <button className="primary-button" type="button" disabled={disabled || !current || (!vm.review && writeCount === 0)}
            aria-busy={vm.busy === "review" || vm.busy === "apply"}
            onClick={() => void (vm.review ? vm.apply() : vm.prepare())}>
            {writingTask ? <TaskGlyph phase={writingTask.phase} runId={writingTask.id} /> : <FileSearch size={15} />}
            {vm.busy === "apply" ? "写入中…" : vm.busy === "review" ? "检查中…" : vm.review
              ? "确认写入 UE" : writeCount > 0 ? `检查写入差异 · ${writeCount} 项` : "检查写入差异"}
          </button>
        </footer>
      </main>
    </div>
  </div></TaskMotionScope>;
}
