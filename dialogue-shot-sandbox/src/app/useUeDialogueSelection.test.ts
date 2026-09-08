import { describe, expect, it } from "vitest";
import type { SelectedDialogueNodeResult } from "../types";
import {
  nextSelectionPollInterval,
  SELECTION_POLL_MAX_INTERVAL_MS,
  SELECTION_POLL_MIN_INTERVAL_MS,
} from "./useUeDialogueSelection";

function selection(
  dialogueNodeId: string | null,
  status: SelectedDialogueNodeResult["status"] = "selected",
): SelectedDialogueNodeResult {
  return {
    status,
    dialogueNodeId,
    selectedNodeCount: dialogueNodeId ? 1 : 0,
    nodes: dialogueNodeId
      ? [{
          nodeClass: "SeriaEdDialogGraphNode",
          nodeTitle: dialogueNodeId,
          nodeComment: "",
          dialogueNodeId,
        }]
      : [],
    message: dialogueNodeId
      ? `已同步 UE 节点 ${dialogueNodeId}`
      : "UE 当前没有选中图节点",
  };
}

describe("UE dialogue selection polling backoff", () => {
  it("starts at three seconds and backs off to five seconds", () => {
    const selected = selection("734219");

    const initialInterval = nextSelectionPollInterval(
      null,
      selected,
      SELECTION_POLL_MIN_INTERVAL_MS,
    );
    const firstBackoff = nextSelectionPollInterval(
      selected,
      selected,
      initialInterval,
    );
    const secondBackoff = nextSelectionPollInterval(
      selected,
      selected,
      firstBackoff,
    );
    const cappedBackoff = nextSelectionPollInterval(
      selected,
      selected,
      secondBackoff,
    );

    expect(initialInterval).toBe(3_000);
    expect(firstBackoff).toBe(4_000);
    expect(secondBackoff).toBe(5_000);
    expect(cappedBackoff).toBe(SELECTION_POLL_MAX_INTERVAL_MS);
  });

  it("returns to three seconds when the selected node changes", () => {
    expect(
      nextSelectionPollInterval(
        selection("734219"),
        selection("734220"),
        SELECTION_POLL_MAX_INTERVAL_MS,
      ),
    ).toBe(SELECTION_POLL_MIN_INTERVAL_MS);
  });

  it("backs off repeated offline results but resets after recovery", () => {
    const offline = selection(null, "offline");
    const selected = selection("735201");

    expect(
      nextSelectionPollInterval(
        offline,
        offline,
        SELECTION_POLL_MIN_INTERVAL_MS,
      ),
    ).toBe(4_000);
    expect(
      nextSelectionPollInterval(
        offline,
        selected,
        SELECTION_POLL_MAX_INTERVAL_MS,
      ),
    ).toBe(SELECTION_POLL_MIN_INTERVAL_MS);
  });
});
