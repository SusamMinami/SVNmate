import { useRef, useState } from "react";
import type { ShotPlan } from "../types";

export function ShotRefinementPanel({ shot, state, disabled, onStart, onCancel, onAdopt, onDismiss, onPreview }: {
  shot: ShotPlan;
  state: { shotId: string; busy: boolean; message: string; proposed?: ShotPlan[]; preview?: boolean } | null;
  disabled: boolean;
  onStart: (instruction: string) => void;
  onCancel: () => void;
  onAdopt: () => void;
  onDismiss: () => void;
  onPreview: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const transition = (action: () => void) => { panel.current?.focus({ preventScroll: true }); action(); };
  const [instruction, setInstruction] = useState("");
  const proposed = state?.shotId === shot.id ? state.proposed?.find((item) => item.id === shot.id) : undefined;
  return <section ref={panel} tabIndex={-1} className="inspector-section shot-refinement" aria-label="TRAE 局部精修">
    <div className="section-label"><span>TRAE 局部精修</span></div>
    <p>只调整当前镜头，保留对白覆盖、站位与动作。</p>
    <label>
      精修要求
      <textarea value={instruction} maxLength={1000} rows={2}
        placeholder="例如：保留听者反应，拉开与上一镜的景别差异"
        disabled={disabled || state?.busy}
        onChange={(event) => setInstruction(event.target.value)} />
    </label>
    <div className="shot-refinement__actions">
      <button className="button button--secondary" disabled={disabled || state?.busy || instruction.trim().length < 2}
        onClick={() => onStart(instruction)}>精修当前镜头</button>
      {state?.busy && <button className="button button--secondary" onClick={() => transition(onCancel)}>停止精修</button>}
    </div>
    {state && <p role="status">{state.shotId !== shot.id ? `${state.shotId}：` : ""}{state.message}</p>}
    {proposed && <>
      <p><strong>精修理由：</strong>{proposed.rationale}</p>
      <p>{shot.label} · {shot.focalLength}mm → {proposed.label} · {proposed.focalLength}mm</p>
      <div className="shot-refinement__actions">
        <button className="button button--secondary" disabled={disabled} aria-pressed={Boolean(state?.preview)} onClick={onPreview}>{state?.preview ? "返回当前镜头" : "预览精修镜头"}</button>
        <button className="button button--secondary" disabled={disabled} onClick={() => transition(onAdopt)}>采纳精修到草稿</button>
        <button className="button button--secondary" onClick={() => transition(onDismiss)}>保留当前镜头</button>
      </div>
    </>}
  </section>;
}
