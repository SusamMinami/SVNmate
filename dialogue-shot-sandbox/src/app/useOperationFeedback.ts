import { useCallback, useState } from "react";
import type { TaskPhase } from "../taskFeedback";

/** Presentation only: callers own requests, confirmations and their actual completion. */
export function useOperationFeedback(initialStatus = "") {
  const [busy, setBusy] = useState(false);
  const [error, storeError] = useState("");
  const [status, storeStatus] = useState(initialStatus);
  const [phase, setPhase] = useState<TaskPhase>("ready");
  const [runId, setRunId] = useState(0);
  const [label, setTaskLabel] = useState("");
  const [operation, setOperation] = useState("");

  function beginTask(message: string, operation = "") {
    setOperation(operation);
    setRunId((current) => current + 1);
    setTaskLabel(message);
    storeError("");
    storeStatus("");
    setPhase("ready");
    setBusy(true);
  }

  const setStatus = useCallback((message: string, outcome: TaskPhase = "ready") => {
    storeStatus(message);
    if (message) {
      storeError("");
      setPhase(outcome);
    }
  }, []);

  function setError(message: string, outcome: TaskPhase = "failed") {
    storeError(message);
    if (message) {
      storeStatus("");
      setPhase(outcome);
    }
  }

  return {
    busy, setBusy, error, status, setError, setStatus, beginTask, setTaskLabel,
    activeOperation: busy ? operation : "",
    feedback: {
      runId,
      phase: busy ? "running" as const : phase,
      message: busy ? label : error || status,
    },
  };
}
