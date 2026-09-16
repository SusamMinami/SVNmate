import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
  const shellRef = useRef<HTMLElement>(null);
  const [navigation, setNavigation] = useState({
    active: initialWorkspace,
    visible: new Set([initialWorkspace]),
    direction: "up" as WorkspaceDirection,
  });
  const currentRef = useRef(navigation);
  const positionsRef = useRef(new Map<WorkspaceView, string>());
  const animationsRef = useRef<Animation[]>([]);
  const revisionRef = useRef(0);

  const cancelAnimations = useCallback(() => {
    revisionRef.current++;
    animationsRef.current.forEach((animation) => animation.cancel());
    animationsRef.current = [];
  }, []);

  const settle = useCallback(() => {
    cancelAnimations();
    positionsRef.current.clear();
    const next = { ...currentRef.current, visible: new Set([currentRef.current.active]) };
    currentRef.current = next;
    setNavigation(next);
  }, [cancelAnimations]);

  const switchWorkspace = useCallback(
    (nextWorkspace: WorkspaceView) => {
      const current = currentRef.current;
      if (nextWorkspace === current.active) return;
      // Sample before cancelling: reversing and third-page navigation both retain
      // the actual visible positions, including every still-departing page.
      positionsRef.current.clear();
      shellRef.current?.querySelectorAll<HTMLElement>(":scope > [data-workspace-id]:not([hidden])")
        .forEach((element) => {
          positionsRef.current.set(element.dataset.workspaceId as WorkspaceView,
            getComputedStyle(element).transform);
        });
      cancelAnimations();
      const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        || shellRef.current?.dataset.navigationInput === "keyboard";
      const next = {
        active: nextWorkspace,
        visible: instant ? new Set([nextWorkspace]) : new Set([...current.visible, nextWorkspace]),
        direction: (WORKSPACE_ORDER[nextWorkspace] > WORKSPACE_ORDER[current.active]
          ? "up" : "down") as WorkspaceDirection,
      };
      currentRef.current = next;
      setNavigation(next);
    },
    [cancelAnimations],
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
        const target = workspace === navigation.active ? 0
          : WORKSPACE_ORDER[workspace] < WORKSPACE_ORDER[navigation.active] ? -100 : 100;
        const from = positionsRef.current.get(workspace)
          ?? `translate3d(0, ${navigation.direction === "up" ? 100 : -100}%, 0)`;
        animations.push(element.animate(
          [{ transform: from }, { transform: `translate3d(0, ${target}%, 0)` }],
          { duration: Number.isFinite(duration) ? duration : 0,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" },
        ));
      });
    animationsRef.current = animations;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (revisionRef.current === revision) settle();
    });
    return cancelAnimations;
  }, [navigation, cancelAnimations, settle]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => { if (media.matches) settle(); };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [settle]);

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
