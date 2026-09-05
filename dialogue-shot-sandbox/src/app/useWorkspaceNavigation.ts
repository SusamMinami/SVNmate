import { useCallback, useEffect, useRef, useState } from "react";

export type WorkspaceView = "storyboard" | "npc" | "migration" | "targets";
export type WorkspaceDirection = "up" | "down";

const WORKSPACE_ORDER: Record<WorkspaceView, number> = {
  storyboard: 0,
  npc: 1,
  targets: 2,
  migration: 3,
};
const WORKSPACE_TRANSITION_MS = 480;

function workspaceTransitionDuration(): number {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : WORKSPACE_TRANSITION_MS;
}

export function useWorkspaceNavigation(
  initialWorkspace: WorkspaceView = "storyboard",
) {
  const [activeWorkspace, setActiveWorkspace] =
    useState<WorkspaceView>(initialWorkspace);
  const [outgoingWorkspace, setOutgoingWorkspace] =
    useState<WorkspaceView | null>(null);
  const [workspaceDirection, setWorkspaceDirection] =
    useState<WorkspaceDirection>("up");
  const transitionTimerRef = useRef<number | null>(null);

  const switchWorkspace = useCallback(
    (nextWorkspace: WorkspaceView) => {
      if (nextWorkspace === activeWorkspace) {
        return;
      }
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
      setWorkspaceDirection(
        WORKSPACE_ORDER[nextWorkspace] > WORKSPACE_ORDER[activeWorkspace]
          ? "up"
          : "down",
      );
      setOutgoingWorkspace(activeWorkspace);
      setActiveWorkspace(nextWorkspace);
      transitionTimerRef.current = window.setTimeout(() => {
        setOutgoingWorkspace(null);
        transitionTimerRef.current = null;
      }, workspaceTransitionDuration());
    },
    [activeWorkspace],
  );

  const closeToolWorkspace = useCallback(
    () => switchWorkspace("storyboard"),
    [switchWorkspace],
  );

  useEffect(
    () => () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    },
    [],
  );

  return {
    activeWorkspace,
    outgoingWorkspace,
    workspaceDirection,
    switchWorkspace,
    closeToolWorkspace,
  };
}
