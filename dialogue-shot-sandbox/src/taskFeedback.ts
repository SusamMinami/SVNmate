/** Presentation states only. They never start, finish or retry a business operation. */
export type TaskPhase = "idle" | "running" | "ready" | "success" | "warning" | "failed" | "cancelled" | "uncertain";

export interface TaskFeedback {
  id: number;
  action: "catalog" | "scan" | "refresh" | "review" | "apply";
  phase: TaskPhase;
}
