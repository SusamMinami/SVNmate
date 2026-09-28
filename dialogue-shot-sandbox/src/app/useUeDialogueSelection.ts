import { useEffect, useRef, useState } from "react";
import type { SelectedDialogueNodeResult } from "../types";
import { readSelectedDialogueNode } from "../ue/client";
import { createSelectionActivity, type SelectionActivity } from "./selectionActivity";

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

export function useUeDialogueSelection(
  enabled: boolean,
  paused = false,
): {
  selection: SelectedDialogueNodeResult | null;
  refreshing: boolean;
  activity: SelectionActivity;
  suspended: boolean;
} {
  const [selection, setSelection] =
    useState<SelectedDialogueNodeResult | null>(null);
  const selectionRef = useRef<SelectedDialogueNodeResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activity] = useState(createSelectionActivity);
  const inFlight = useRef<Promise<SelectedDialogueNodeResult> | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (!enabled) {
      selectionRef.current = null;
      setSelection(null);
      setVerified(false);
      setRefreshing(false);
      activity.update({ polling: false, intervalMs: SELECTION_POLL_MIN_INTERVAL_MS });
      return;
    }
    if (paused) {
      setVerified(false);
      setRefreshing(false);
      activity.update({ ...activity.getSnapshot(), polling: false });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let initialReadPending = true;
    let lastSelection: SelectedDialogueNodeResult | null = null;
    let pollIntervalMs = SELECTION_POLL_MIN_INTERVAL_MS;
    const poll = async () => {
      // Pausing cannot cancel a request already executing in UE. Drain it before
      // resuming, discard its result and then revalidate the current selection.
      if (inFlight.current) await inFlight.current.catch(() => {});
      if (cancelled) return;
      const pollStartedAt = Date.now();
      activity.update({ polling: true, intervalMs: pollIntervalMs });
      if (initialReadPending) {
        setRefreshing(true);
      }
      let next: SelectedDialogueNodeResult;
      const request = readSelectedDialogueNode(initialReadPending);
      inFlight.current = request;
      try {
        next = await request;
        if (!cancelled) {
          if (initialReadPending) setVerified(true);
          if (!sameSelection(selectionRef.current, next)) {
            selectionRef.current = next;
            setSelection(next);
          }
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
          if (initialReadPending) setVerified(true);
          if (!sameSelection(selectionRef.current, next)) {
            selectionRef.current = next;
            setSelection(next);
          }
        }
      } finally {
        if (inFlight.current === request) inFlight.current = null;
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
          activity.update({ polling: false, intervalMs: pollIntervalMs });
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
  }, [enabled, paused, activity]);

  return {
    // Retain the rendered editor/drafts while suspended; callers must lock controls
    // and automatic reads until a fresh response verifies the selection.
    selection: enabled ? selection : null,
    suspended: !enabled || paused || !verified,
    refreshing: enabled && !paused && refreshing,
    activity,
  };
}
