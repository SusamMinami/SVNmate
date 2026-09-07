import { useEffect, useRef, useState } from "react";
import { Boxes, LoaderCircle, RefreshCw, Square, X, Check, Unlink } from "lucide-react";
import type { useSceneReference } from "../app/useSceneReference";
import type { SceneReference } from "../scene/sceneReference";

interface Props {
  control: ReturnType<typeof useSceneReference>;
  applyDisabled: boolean;
  onApply: (scene: SceneReference) => Promise<void>;
  onClear: () => Promise<void>;
}

export function SceneReferencePanel({ control, applyDisabled, onApply, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState("");
  const [selected, setSelected] = useState(new Set<string>());
  const [share, setShare] = useState(false);
  const [applying, setApplying] = useState(false);
  const [localError, setLocalError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setAnchor(""); setSelected(new Set()); setShare(false); setLocalError("");
  }, [control.key]);
  useEffect(() => {
    const candidates = control.inspection?.candidates ?? [];
    const selectedActors = candidates.filter((candidate) => candidate.source === "selected_actor");
    setAnchor((current) => candidates.some((candidate) => candidate.id === current) ? current :
      selectedActors.length === 1 ? selectedActors[0].id : candidates.length === 1 ? candidates[0].id : "");
  }, [control.inspection]);
  useEffect(() => {
    setSelected(new Set(control.draft?.objects.map((object) => object.id) ?? []));
    setShare(false);
  }, [control.draft]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  async function apply() {
    setApplying(true); setLocalError("");
    try {
      const scene = await control.accept(selected, share, anchor);
      if (scene) { await onApply(scene); setOpen(false); }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "场景应用失败");
    } finally { setApplying(false); }
  }
  const warnings = control.draft?.warnings ?? control.inspection?.warnings ?? [];
  return (
    <div className="scene-reference" ref={ref} onKeyDown={(event) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    }}>
      <button ref={triggerRef} type="button" className="scene-reference__trigger"
        title={control.current ? `场景快照 · ${control.current.objects.length} 个参考对象 · 未实时核验` : "场景参考"}
        aria-label="场景参考" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Boxes size={15} /><span>场景{control.current ? ` · ${control.current.objects.length}` : ""}</span>
      </button>
      {open && <section className="scene-reference__panel" aria-label="场景参考工具">
        <header>
          <strong>场景参考</strong>
          <span>包围盒快照 · 非实时</span>
          <button type="button" title="关闭场景参考" aria-label="关闭场景参考" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={15} /></button>
        </header>
        <div className="scene-reference__body">
          {!control.request && <p className="scene-reference__notice">尚无当前对话的 BP 坐标基准，请先读取并沿用 BP 占位。</p>}
          {control.current && <p className="scene-reference__status" title={control.current.mapPath}>
            已应用：{control.current.mapPath.split("/").at(-1)} · {control.current.objects.length} 个对象 · {new Date(control.current.capturedAt).toLocaleTimeString()}
          </p>}
          <div className="scene-reference__controls">
            <label>采集半径 <input aria-label="场景采集半径" type="number" min={5} max={60} step={5} value={control.radius}
              disabled={control.busy} onChange={(event) => control.setRadius(Math.max(5, Math.min(60, Number(event.target.value) || 5)))} /> m</label>
            <button type="button" disabled={!control.request || control.busy} onClick={() => void control.read()}>
              <RefreshCw size={13} />读取落点
            </button>
            {control.busy && <button type="button" onClick={control.cancel}><Square size={12} />中断</button>}
          </div>
          {control.busy && <p role="status"><LoaderCircle className="spin" size={13} />正在只读采集 UE 场景</p>}
          {control.inspection && <>
            <p title={control.inspection.mapPath}>当前地图：{control.inspection.mapPath.split("/").at(-1)}</p>
            <label className="scene-reference__anchor">场景落点 · 世界 cm
              <select aria-label="场景落点" value={anchor} disabled={control.busy || applying} onChange={(event) => {
                setAnchor(event.target.value);
                control.invalidateDraft();
              }}>
                <option value="">选择已核对的落点</option>
                {control.inspection.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>
                  {candidate.label} · {candidate.source === "selected_actor" ? "UE 已选择" : candidate.source === "level_actor" ? "关卡实例" : "对话元数据"}
                  {` (${Math.round(candidate.transform.location.x)}, ${Math.round(candidate.transform.location.y)}, ${Math.round(candidate.transform.location.z)})`}
                </option>)}
              </select>
            </label>
            {control.inspection.candidates.length === 0 && <p className="scene-reference__notice">当前地图没有可确认落点，请核对地图、BP 实例及对话空间配置后重读。</p>}
            <button type="button" disabled={!anchor || control.busy} onClick={() => void control.read(anchor)}><Boxes size={13} />确认落点并采集附近模型</button>
          </>}
          {control.draft && <>
            <div className="scene-reference__selection">
              <label><input type="checkbox" aria-label="选择全部场景对象"
                checked={control.draft.objects.length > 0 && selected.size === control.draft.objects.length}
                onChange={(event) => setSelected(new Set(event.target.checked ? control.draft!.objects.map((object) => object.id) : []))} />参考对象</label>
              <span>{selected.size} / {control.draft.objects.length}</span>
            </div>
            {control.draft.objects.length === 0 && <p>范围内未采集到支持的静态网格。</p>}
            <table className="scene-reference__objects"><thead><tr><th>对象</th><th>尺寸 m</th></tr></thead>
              <tbody>{control.draft.objects.map((object) => <tr key={object.id}>
                <td><label title={`${object.assetPath}\n${object.id}`}><input type="checkbox" checked={selected.has(object.id)} onChange={(event) => {
                  setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(object.id); else next.delete(object.id); return next; });
                }} /><span>{object.label}</span></label></td>
                <td>{object.size.map((value) => value.toFixed(1)).join(" × ")}</td>
              </tr>)}</tbody>
            </table>
            <label className="scene-reference__share"><input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />允许 AI 接收所选场景名称与空间数据</label>
          </>}
          {warnings.map((warning) => <p className="scene-reference__notice" key={warning}>{warning}</p>)}
          {(control.error || localError) && <p className="scene-reference__error" role="alert">{control.error || localError}</p>}
        </div>
        <footer>
          <button type="button" disabled={!control.current || applyDisabled || applying || control.busy} onClick={() => {
            control.clear(); void onClear().catch((error: unknown) => setLocalError(error instanceof Error ? error.message : "解除引用失败"));
          }}><Unlink size={13} />解除引用并重算</button>
          <button type="button" className="scene-reference__apply" disabled={!control.draft || control.draft.anchor.id !== anchor || applyDisabled || applying || control.busy} onClick={() => void apply()}>
            {applying ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}应用并重算规则镜头
          </button>
        </footer>
      </section>}
    </div>
  );
}
