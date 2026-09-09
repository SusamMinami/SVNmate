import { useEffect, useState } from "react";
import type { SelectedDialogueNodeResult } from "../types";
import { readSelectedDialogueNode } from "../ue/client";

export const SELECTION_POLL_MIN_INTERVAL_MS = 1_200;
export const SELECTION_POLL_MAX_INTERVAL_MS = 5_000;
const SELECTION_POLL_BACKOFF_STEP_MS = 1_000;
const SELECTION_POLL_MIN_DELAY_AFTER_RESPONSE_MS = 250;

function sameSelection(
  current: SelectedDialogueNodeResult | null,
  next: SelectedDialogueNodeResult,
): boolean {
  if (!current) {
    return false;
  }
  return (
    current.status === next.status &&
    current.dialogueNodeId === next.dialogueNodeId &&
    current.selectedNodeCount === next.selectedNodeCount &&
    current.message === next.message &&
    current.nodes.length === next.nodes.length &&
    current.nodes.every((node, index) => {
      const nextNode = next.nodes[index];
      return (
        node.nodeClass === nextNode.nodeClass &&
        node.nodeTitle === nextNode.nodeTitle &&
        node.nodeComment === nextNode.nodeComment &&
        node.dialogueNodeId === nextNode.dialogueNodeId
      );
    })
  );
}

export function nextSelectionPollInterval(
  current: SelectedDialogueNodeResult | null,
  next: SelectedDialogueNodeResult,
  currentIntervalMs: number,
): number {
  return current?.status === "offline" && next.status === "offline"
    ? Math.min(
        SELECTION_POLL_MAX_INTERVAL_MS,
        Math.max(SELECTION_POLL_MIN_INTERVAL_MS, currentIntervalMs) +
          SELECTION_POLL_BACKOFF_STEP_MS,
      )
    : SELECTION_POLL_MIN_INTERVAL_MS;
}

export function selectionPollDelayAfterResponse(
  intervalMs: number,
  requestDurationMs: number,
): number {
  return Math.max(
    SELECTION_POLL_MIN_DELAY_AFTER_RESPONSE_MS,
    intervalMs - requestDurationMs,
  );
}

export function useUeDialogueSelection(enabled: boolean): {
  selection: SelectedDialogueNodeResult | null;
  refreshing: boolean;
  polling: boolean;
  pollIntervalMs: number;
} {
  const [selection, setSelection] =
    useState<SelectedDialogueNodeResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollIntervalMs, setPollIntervalMs] = useState(
    SELECTION_POLL_MIN_INTERVAL_MS,
  );

  useEffect(() => {
    if (!enabled) {
      setSelection(null);
      setRefreshing(false);
      setPolling(false);
      setPollIntervalMs(SELECTION_POLL_MIN_INTERVAL_MS);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let initialReadPending = true;
    let lastSelection: SelectedDialogueNodeResult | null = null;
    let pollIntervalMs = SELECTION_POLL_MIN_INTERVAL_MS;
    const poll = async () => {
      const pollStartedAt = Date.now();
      setPolling(true);
      if (initialReadPending) {
        setRefreshing(true);
      }
      let next: SelectedDialogueNodeResult;
      try {
        next = await readSelectedDialogueNode();
        if (!cancelled) {
          setSelection((current) =>
            sameSelection(current, next) ? current : next,
          );
        }
      } catch (error) {
        next = {
          status: "offline",
          dialogueNodeId: null,
          selectedNodeCount: 0,
          nodes: [],
          message:
            error instanceof Error
              ? error.message
              : "无法读取 UE 当前节点",
        };
        if (!cancelled) {
          setSelection((current) =>
            sameSelection(current, next) ? current : next,
          );
        }
      } finally {
        if (!cancelled) {
          pollIntervalMs = nextSelectionPollInterval(
            lastSelection,
            next!,
            pollIntervalMs,
          );
          const pollDurationMs = Date.now() - pollStartedAt;
          const nextDelayMs = selectionPollDelayAfterResponse(
            pollIntervalMs,
            pollDurationMs,
          );
          setPollIntervalMs(pollIntervalMs);
          setPolling(false);
          lastSelection = next!;
          if (initialReadPending) {
            initialReadPending = false;
            setRefreshing(false);
          }
          timer = globalThis.setTimeout(
            poll,
            nextDelayMs,
          );
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) {
        globalThis.clearTimeout(timer);
      }
    };
  }, [enabled]);

  return { selection, refreshing, polling, pollIntervalMs };
}
