import { useEffect, useState } from "react";
import type { SelectedDialogueNodeResult } from "../types";
import { readSelectedDialogueNode } from "../ue/client";

const SELECTION_POLL_INTERVAL_MS = 800;

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

    const poll = async () => {
      setRefreshing(true);
      try {
        const next = await readSelectedDialogueNode();
        if (!cancelled) {
          setSelection(next);
        }
      } catch (error) {
        if (!cancelled) {
          setSelection({
            status: "offline",
            dialogueNodeId: null,
            selectedNodeCount: 0,
            nodes: [],
            message:
              error instanceof Error
                ? error.message
                : "无法读取 UE 当前节点",
          });
        }
      } finally {
        if (!cancelled) {
          setRefreshing(false);
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
