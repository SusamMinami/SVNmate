import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotionPreference } from "./useReducedMotionPreference";

export type WorkspaceView = "storyboard" | "npc" | "migration" | "targets" | "animation";
export type WorkspaceDirection = "up" | "down";

const WORKSPACE_ORDER: Record<WorkspaceView, number> = {
  storyboard: 0,
  npc: 1,
  targets: 2,
  migration: 3,
  animation: 4,
};
export function useWorkspaceNavigation(
  initialWorkspace: WorkspaceView = "storyboard",
) {
  const { reducedMotion } = useReducedMotionPreference();
  const shellRef = useRef<HTMLElement>(null);
  const [navigation, setNavigation] = useState({
    active: initialWorkspace,
    visible: new Set([initialWorkspace]),
    direction: "up" as WorkspaceDirection,
  });
  const currentRef = useRef(navigation);
  const opacitiesRef = useRef(new Map<WorkspaceView, string>());
  const animationsRef = useRef<Animation[]>([]);
  const revisionRef = useRef(0);

  const cancelAnimations = useCallback(() => {
    revisionRef.current++;
    animationsRef.current.forEach((animation) => animation.cancel());
    animationsRef.current = [];
  }, []);

  const settle = useCallback(() => {
    cancelAnimations();
    opacitiesRef.current.clear();
    const next = { ...currentRef.current, visible: new Set([currentRef.current.active]) };
    currentRef.current = next;
    setNavigation(next);
  }, [cancelAnimations]);

  const switchWorkspace = useCallback(
    (nextWorkspace: WorkspaceView) => {
      const current = currentRef.current;
      if (nextWorkspace === current.active) return;
      // Sample before cancelling so reversals and third-page navigation continue
      // from each page's currently visible opacity.
      opacitiesRef.current.clear();
      shellRef.current?.querySelectorAll<HTMLElement>(":scope > [data-workspace-id]:not([hidden])")
        .forEach((element) => {
          opacitiesRef.current.set(element.dataset.workspaceId as WorkspaceView,
            getComputedStyle(element).opacity);
        });
      cancelAnimations();
      const instant = reducedMotion ||
        shellRef.current?.dataset.navigationInput === "keyboard";
      const next = {
        active: nextWorkspace,
        visible: instant ? new Set([nextWorkspace]) : new Set([...current.visible, nextWorkspace]),
        direction: (WORKSPACE_ORDER[nextWorkspace] > WORKSPACE_ORDER[current.active]
          ? "up" : "down") as WorkspaceDirection,
      };
      currentRef.current = next;
      setNavigation(next);
    },
    [cancelAnimations, reducedMotion],
  );

  useLayoutEffect(() => {
    if (navigation.visible.size < 2 || !shellRef.current) return;
    const revision = revisionRef.current;
    // CSS owns the duration; finished/cancelled animations own visibility cleanup.
    const duration = Number.parseFloat(
      getComputedStyle(shellRef.current).getPropertyValue("--motion-workspace"),
    );
    const animations: Animation[] = [];
    shellRef.current.querySelectorAll<HTMLElement>(":scope > [data-workspace-id]:not([hidden])")
      .forEach((element) => {
        const workspace = element.dataset.workspaceId as WorkspaceView;
        const target = workspace === navigation.active ? "1" : "0";
        const from = opacitiesRef.current.get(workspace)
          ?? (workspace === navigation.active ? "0" : "1");
        animations.push(element.animate(
          [{ opacity: from }, { opacity: target }],
          { duration: Number.isFinite(duration) ? duration : 0,
            easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "both" },
        ));
      });
    animationsRef.current = animations;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (revisionRef.current === revision) settle();
    });
    return cancelAnimations;
  }, [navigation, cancelAnimations, settle]);

  useEffect(() => {
    if (reducedMotion) settle();
  }, [reducedMotion, settle]);

  const closeToolWorkspace = useCallback(
    () => switchWorkspace("storyboard"),
    [switchWorkspace],
  );

  return {
    shellRef,
    activeWorkspace: navigation.active,
    workspaceDirection: navigation.direction,
    visibleWorkspaces: navigation.visible,
    workspaceProps: (workspace: WorkspaceView) => ({
      "data-workspace-id": workspace,
      "data-workspace-state": workspace === navigation.active
        ? navigation.visible.size > 1 ? "entering" : "active"
        : navigation.visible.has(workspace) ? "exiting" : "inactive",
      hidden: !navigation.visible.has(workspace),
      inert: workspace !== navigation.active || undefined,
      "aria-hidden": workspace !== navigation.active || undefined,
    }),
    switchWorkspace,
    closeToolWorkspace,
  };
}
