import { useLayoutEffect, useRef, useState } from "react";
import type { DialogueSequence, ShotPlan } from "../types";
import { MiraReadyResponseSchema, type DirectorBlocking, type DirectorSceneAnalysis } from "../director/contracts";
import { applyRefinement, createShotRefinementRequest, type ShotRefinementRequest } from "../director/shotRefinement";
import { cancelTraeTask, getTraeRefinement, submitTraeRefinement } from "../trae/client";

interface RefinementState {
  shotId: string;
  busy: boolean;
  message: string;
  proposed?: ShotPlan[];
  preview?: boolean;
}

function delay(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, 1000);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export function useShotRefinement(
  sequence: DialogueSequence, shots: ShotPlan[], enabled: boolean,
  blocking: DirectorBlocking, analysis: DirectorSceneAnalysis | undefined,
  onApply: (shots: ShotPlan[]) => void, onStart: () => void,
) {
  const [state, setState] = useState<RefinementState | null>(null);
  const active = useRef<{ controller: AbortController; requestId?: string } | null>(null);
  const source = useRef({ sequence, shots, enabled });
  const expected = useRef<ShotPlan[] | null>(null);
  const baseline = useRef<ShotPlan[] | null>(null);
  const mounted = useRef(true);

  function cancelTask() {
    const task = active.current;
    active.current = null;
    task?.controller.abort();
    if (task?.requestId) void cancelTraeTask(task.requestId, undefined, "局部精修已停止或基线已变化").catch(() => undefined);
  }
  useLayoutEffect(() => {
    source.current = { sequence, shots, enabled };
    if (expected.current === shots) { expected.current = null; return; }
    cancelTask();
    baseline.current = null;
    setState((current) => current ? {
      ...current, busy: false, proposed: undefined,
      message: "当前方案已变化，旧精修结果已失效。可基于当前镜头重新提交。",
    } : null);
  }, [sequence, shots, enabled, blocking, analysis]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelTask(); };
  }, []);

  async function start(index: number, instruction: string) {
    if (!enabled || active.current) return;
    let request: ShotRefinementRequest;
    try {
      request = createShotRefinementRequest(sequence, shots, [index], instruction, blocking, analysis);
    } catch {
      setState({ shotId: shots[index]?.id ?? "", busy: false,
        message: "当前方案缺少完整导演决策，请先生成分镜后重试。" });
      return;
    }
    onStart();
    const task = { controller: new AbortController(), requestId: undefined as string | undefined };
    active.current = task;
    baseline.current = shots;
    const current = () => mounted.current && !task.controller.signal.aborted &&
      active.current === task && source.current.sequence === sequence &&
      source.current.shots === shots && source.current.enabled;
    setState({ shotId: shots[index].id, busy: true, message: "正在提交当前镜头精修" });
    try {
      const created = await submitTraeRefinement(request);
      task.requestId = created.requestId;
      if (!current()) {
        void cancelTraeTask(created.requestId, undefined, "提交期间基线已变化或用户已停止").catch(() => undefined);
        return;
      }
      if (created.requestId !== request.input.request_id) throw new Error("精修任务标识不一致");
      while (current()) {
        const status = await getTraeRefinement(created.requestId, task.controller.signal);
        if (!current()) return;
        if (status.requestId !== created.requestId || status.baselineVersion !== created.baselineVersion) {
          throw new Error("精修结果版本不一致，请重新提交");
        }
        if (status.status === "completed") {
          const plan = MiraReadyResponseSchema.parse(status.result);
          if (plan.request_id !== created.requestId) throw new Error("精修结果不属于当前任务");
          // Verify the response scope again before any local mutation.
          const { mergeRefinementPatch } = await import("../director/shotRefinement");
          const accepted = mergeRefinementPatch({ ...request, baseline_version: created.baselineVersion }, {
            baseline_version: created.baselineVersion,
            replacements: request.target_indexes.map((i) => ({ shot_index: i, decision: plan.shots[i] })),
          });
          if (JSON.stringify(accepted) !== JSON.stringify(plan)) throw new Error("精修结果超出本次修改范围");
          const proposed = applyRefinement(request, shots, plan);
          if (current()) setState({ shotId: shots[index].id, busy: false, proposed,
            message: "精修已通过本地验收，可采纳到当前草稿。" });
          return;
        }
        if (status.status === "cancelled" || status.status === "failed") {
          throw new Error(status.error || "局部精修未完成");
        }
        setState({ shotId: shots[index].id, busy: true, message: status.status === "processing"
          ? "TRAE 正在精修当前镜头" : "已排队；在 TRAE 中输入「处理待分镜任务」" });
        await delay(task.controller.signal);
      }
    } catch (error) {
      if (current()) {
        setState({ shotId: shots[index].id, busy: false,
          message: error instanceof Error ? error.message : "精修未完成，请重试" });
        cancelTask();
      }
    } finally {
      if (active.current === task) active.current = null;
    }
  }
  function adopt() {
    if (!enabled || !state?.proposed || baseline.current !== source.current.shots) return;
    expected.current = state.proposed;
    onApply(state.proposed);
    setState({ ...state, proposed: undefined, message: "已采纳当前镜头精修，尚未写入 UE。" });
  }
  return { state, start, adopt,
    togglePreview() { setState((current) => current?.proposed ? { ...current, preview: !current.preview } : current); },
    cancel() { cancelTask(); setState((current) => current && {
      ...current, busy: false, proposed: undefined, message: "已停止精修，保留当前方案。",
    }); },
    dismiss() { setState((current) => current && {
      ...current, proposed: undefined, message: "已保留当前镜头。",
    }); },
  };
}
