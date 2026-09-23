import { useLayoutEffect, useRef, useState } from "react";
import type { DialogueSequence, ShotPlan } from "../types";
import { reviewExistingStoryboard, type ExistingStoryboardReview } from "../director/existingStoryboardReview";

export function useExistingStoryboardReview(sequence: DialogueSequence, shots: ShotPlan[], enabled: boolean) {
  const [report, setReport] = useState<ExistingStoryboardReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const controller = useRef<AbortController | null>(null);
  const source = useRef({ sequence, shots, enabled });

  useLayoutEffect(() => {
    source.current = { sequence, shots, enabled };
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setProgress("");
    setReport(null);
    return () => { controller.current?.abort(); };
  }, [sequence, shots, enabled]);

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setProgress("");
    setReport((current) => current && { ...current, message: "评估已停止，保留已完成的规则检查。" });
  }

  async function start() {
    if (!enabled || !shots.length || controller.current) return;
    const task = new AbortController();
    controller.current = task;
    const isCurrent = () => !task.signal.aborted && controller.current === task &&
      source.current.sequence === sequence && source.current.shots === shots && source.current.enabled;
    setBusy(true);
    setReport(null);
    setProgress("正在检查已有分镜");
    try {
      const result = await reviewExistingStoryboard(sequence, shots, task.signal,
        (message) => { if (isCurrent()) setProgress(message); },
        (rules) => { if (isCurrent()) setReport(rules); });
      if (isCurrent()) setReport(result);
    } catch (error) {
      if (isCurrent()) setReport((current) => current && {
        ...current,
        message: `视觉评估未完成，已保留规则检查：${error instanceof Error ? error.message : "请重试"}`,
      });
    } finally {
      if (isCurrent()) {
        controller.current = null;
        setBusy(false);
        setProgress("");
      }
    }
  }

  return { report, busy, progress, start, cancel };
}
