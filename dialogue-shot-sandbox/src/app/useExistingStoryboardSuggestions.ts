import { useLayoutEffect, useRef, useState } from "react";
import type { DialogueSequence, ShotPlan } from "../types";
import type { ExistingShotReview } from "../director/existingStoryboardReview";
import {
  applyExistingShotSuggestion, suggestExistingShot, type ExistingShotSuggestion,
} from "../director/existingStoryboardSuggestions";

export interface ExistingSuggestionState {
  shotId: string;
  busy: boolean;
  message: string;
  suggestion?: ExistingShotSuggestion;
  preview: boolean;
  adopted: boolean;
  dismissed: boolean;
}

export function useExistingStoryboardSuggestions(
  sequence: DialogueSequence, shots: ShotPlan[], enabled: boolean,
  onApply: (shots: ShotPlan[]) => void,
) {
  const [state, setState] = useState<ExistingSuggestionState | null>(null);
  const controller = useRef<AbortController | null>(null);
  const source = useRef({ sequence, shots, enabled });
  const expected = useRef<ShotPlan[] | null>(null);
  const undo = useRef<ShotPlan[] | null>(null);

  useLayoutEffect(() => {
    source.current = { sequence, shots, enabled };
    controller.current?.abort();
    controller.current = null;
    if (enabled && expected.current === shots) {
      expected.current = null;
    } else {
      expected.current = null;
      undo.current = null;
      setState(null);
    }
    return () => { controller.current?.abort(); };
  }, [sequence, shots, enabled]);

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setState((current) => current && {
      ...current, busy: false, preview: false, message: "已停止生成建议，原镜头保持不变。",
    });
  }

  async function start(review: ExistingShotReview) {
    if (!enabled || controller.current) return;
    const task = new AbortController();
    controller.current = task;
    const isCurrent = () => !task.signal.aborted && controller.current === task &&
      source.current.sequence === sequence && source.current.shots === shots && source.current.enabled;
    setState({ shotId: review.shotId, busy: true, message: "正在准备调整建议",
      preview: false, adopted: false, dismissed: false });
    try {
      const result = await suggestExistingShot(sequence, shots, review, task.signal,
        (message) => { if (isCurrent()) setState((s) => s && { ...s, message }); });
      if (isCurrent()) setState((s) => s && { ...s, ...result, busy: false });
    } catch (error) {
      if (isCurrent()) setState((s) => s && { ...s, busy: false,
        message: `生成建议未完成：${error instanceof Error ? error.message : "请重试"}。原镜头保持不变。` });
    } finally {
      if (isCurrent()) controller.current = null;
    }
  }

  function adopt() {
    if (!enabled || state?.busy || !state?.suggestion || state.adopted || state.dismissed) return;
    const next = applyExistingShotSuggestion(sequence, shots, state.suggestion.original, state.suggestion.proposed);
    if (!next) {
      setState({ ...state, suggestion: undefined, preview: false,
        message: "镜头或相邻关系已变化，请重新评估并生成建议。" });
      return;
    }
    undo.current = shots;
    expected.current = next;
    setState({ ...state, adopted: true, preview: false,
      message: "已采纳到本地草稿，尚未写入 UE。原评分已失效，可重新评估；写入请使用「导出到 UE」。" });
    onApply(next);
  }

  function revert() {
    if (!enabled || !undo.current || !state?.adopted) return;
    const previous = undo.current;
    undo.current = null;
    expected.current = previous;
    setState({ ...state, adopted: false, dismissed: true, preview: false,
      message: "已撤销本次采纳，恢复采纳前的本地镜头。" });
    onApply(previous);
  }

  return {
    state, start, cancel, adopt, revert,
    togglePreview: () => setState((s) => s && !s.adopted && !s.dismissed ? { ...s, preview: !s.preview } : s),
    dismiss: () => setState((s) => s && { ...s, dismissed: true, preview: false, message: "已保留原镜头。需要时可重新生成建议。" }),
  };
}
