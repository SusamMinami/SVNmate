import { useEffect, useState } from "react";
import type { SelectedDialogueNodeResult } from "../types";
import { readSelectedDialogueNode } from "../ue/client";

const SELECTION_POLL_INTERVAL_MS = 1_200;

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

export function useUeDialogueSelection(enabled: boolean): {
  selection: SelectedDialogueNodeResult | null;
  refreshing: boolean;
} {
  const [selection, setSelection] =
    useState<SelectedDialogueNodeResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSelection(null);
      setRefreshing(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let initialReadPending = true;

    const poll = async () => {
      if (initialReadPending) {
        setRefreshing(true);
      }
      try {
        const next = await readSelectedDialogueNode();
        if (!cancelled) {
          setSelection((current) =>
            sameSelection(current, next) ? current : next,
          );
        }
      } catch (error) {
        if (!cancelled) {
          const next: SelectedDialogueNodeResult = {
            status: "offline",
            dialogueNodeId: null,
            selectedNodeCount: 0,
            nodes: [],
            message:
              error instanceof Error
                ? error.message
                : "无法读取 UE 当前节点",
          };
          setSelection((current) =>
            sameSelection(current, next) ? current : next,
          );
        }
      } finally {
        if (!cancelled) {
          if (initialReadPending) {
            initialReadPending = false;
            setRefreshing(false);
          }
          timer = globalThis.setTimeout(
            poll,
            SELECTION_POLL_INTERVAL_MS,
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

  return { selection, refreshing };
}
