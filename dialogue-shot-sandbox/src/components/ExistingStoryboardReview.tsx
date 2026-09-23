import type { ExistingShotReview, ExistingStoryboardReview } from "../director/existingStoryboardReview";
import type { ExistingSuggestionState } from "../app/useExistingStoryboardSuggestions";
import { useRef } from "react";

export function ExistingStoryboardReviewControl({
  report, busy, progress, disabled, onStart, onCancel,
}: {
  report: ExistingStoryboardReview | null;
  busy: boolean;
  progress: string;
  disabled: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const errors = report?.shots.filter((shot) => shot.issues.some((issue) => issue.severity === "error")).length ?? 0;
  const suggestions = report?.shots.filter((shot) => shot.issues.some((issue) => issue.severity === "warning")).length ?? 0;
  return (
    <section tabIndex={-1} className="existing-review-control" aria-label="已有分镜评估">
      <button type="button" className="button" disabled={disabled && !busy}
        onClick={busy ? onCancel : onStart}>
        {busy ? "停止评估" : report ? "重新评估已有分镜" : "评估已有分镜"}
      </button>
      <div role="status" aria-live="polite">
        {busy ? progress : report?.message ?? "复用规则与端侧模型，逐镜给出评分和反馈。"}
      </div>
      {report && (
        <p>
          {report.averageScore !== undefined && <strong>视觉均分 {report.averageScore}/100 · </strong>}
          规则：{errors} 镜未通过 · {suggestions} 镜有建议
        </p>
      )}
    </section>
  );
}

export function ExistingShotReviewPanel({ review, model }: { review: ExistingShotReview; model?: string }) {
  return (
    <section className="inspector-section existing-shot-review">
      <div className="section-label">
        <span>已有分镜评估</span>
        <small>{model ?? "规则检查"}</small>
      </div>
      {review.visual && (
        <>
          <strong>视觉评分 {review.visual.overall}/100</strong>
          <p>{review.visual.assessment}</p>
          <dl className="existing-shot-review__scores">
            <div><dt>构图</dt><dd>{review.visual.composition}</dd></div>
            <div><dt>主体</dt><dd>{review.visual.subject_readability}</dd></div>
            <div><dt>遮挡</dt><dd>{review.visual.occlusion}</dd></div>
            <div><dt>连续</dt><dd>{review.visual.continuity}</dd></div>
          </dl>
          {review.visual.issues.map((issue, index) => <p key={index}>模型建议：{issue}</p>)}
        </>
      )}
      {review.issues.length === 0 ? <p>规则检查未发现明确问题。</p> :
        review.issues.map((issue, index) => (
          <p key={`${issue.ruleId}-${index}`} className={`projection-issue--${issue.severity}`}>
            {issue.severity === "error" ? "未通过" : "建议复核"} · {issue.ruleId}：{issue.message}
          </p>
        ))}
      <p className="existing-shot-review__scope">
        基于角色体型代理与镜头起始画面；连续性结合上一镜参数推断。发言角色仅作参考，不代表已确认主体；不含真实场景遮挡与完整动画验收。
      </p>
    </section>
  );
}

export function ExistingShotSuggestionPanel({
  state, canStart, disabled, subjectName, onStart, onPreview, onAdopt, onDismiss, onRevert,
}: {
  state: ExistingSuggestionState | null;
  canStart: boolean;
  disabled: boolean;
  subjectName: string;
  onStart: () => void;
  onPreview: () => void;
  onAdopt: () => void;
  onDismiss: () => void;
  onRevert: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  function transition(action: () => void) {
    // Move focus only for the user's action, before its button is removed.
    // Async completion and ordinary shot switches must never steal focus.
    panel.current?.focus({ preventScroll: true });
    action();
  }
  const suggestion = state?.suggestion;
  const pending = suggestion && !state.adopted && !state.dismissed;
  const distance = suggestion ? Math.hypot(...suggestion.proposed.cameraPosition.map(
    (value, axis) => value - suggestion.original.cameraPosition[axis])) : 0;
  return (
    <section ref={panel} tabIndex={-1} className="inspector-section existing-shot-suggestion" aria-label="分镜调整建议">
      <div className="section-label"><span>调整建议</span></div>
      {state && !state.busy && <p role="status" aria-live="polite">{state.message}</p>}
      {pending && (
        <>
          <strong>本轮比较 {suggestion.originalScore} → {suggestion.proposedScore}/100</strong>
          <p>{suggestion.reason}</p>
          <p>机位移动 {distance.toFixed(2)} 米，重新调整取景方向；对白覆盖、时长、焦距和运镜位移保持。</p>
          {suggestion.issues.map((issue, index) => <p key={index}>仍需复核：{issue}</p>)}
          <p>以{subjectName}为参考，保留原画面可见角色。请核对原有主体与叙事意图。</p>
          <div className="existing-shot-suggestion__actions">
            <button type="button" className="button" aria-pressed={state.preview}
              disabled={disabled} onClick={onPreview}>{state.preview ? "返回原镜头" : "预览调整方案"}</button>
            <button type="button" className="button" disabled={disabled} onClick={() => transition(onAdopt)}>采纳到草稿</button>
            <button type="button" className="button" disabled={disabled} onClick={() => transition(onDismiss)}>保留原镜头</button>
          </div>
        </>
      )}
      {state?.adopted && <button type="button" className="button" disabled={disabled} onClick={() => transition(onRevert)}>撤销本次采纳</button>}
      {!state?.busy && canStart && !pending && !state?.adopted && (
          <button type="button" className="button" disabled={disabled} onClick={() => transition(onStart)}>
            {state ? "重新生成调整建议" : "生成调整建议"}
          </button>
        )}
      <p className="existing-shot-review__scope">建议只修改本地草稿；代理画面评分不代替 UE 场景与动画验收。</p>
    </section>
  );
}
