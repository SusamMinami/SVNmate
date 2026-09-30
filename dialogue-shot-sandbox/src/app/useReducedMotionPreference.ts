import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

export const REDUCED_MOTION_STORAGE_KEY =
  "shot-sandbox.reduced-motion.v1";
const REDUCED_MOTION_EVENT = "shot-sandbox:reduced-motion";
let volatilePreference: boolean | null = null;

function browserPreviewPreference(): boolean | null {
  if (window.shotSandboxDesktop) {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get("motion");
  return value === "full" ? false : value === "reduced" ? true : null;
}

function storedPreference(): boolean | null {
  const previewPreference = browserPreviewPreference();
  if (previewPreference !== null) {
    return previewPreference;
  }
  try {
    const value = window.localStorage.getItem(REDUCED_MOTION_STORAGE_KEY);
    return value === "true"
      ? true
      : value === "false"
        ? false
        : volatilePreference;
  } catch {
    return volatilePreference;
  }
}

export function isReducedMotionEnabled(): boolean {
  const stored = storedPreference();
  // Full motion is the product default on desktop and browser previews.
  return stored ?? false;
}

export function applyReducedMotionPreference(): boolean {
  const enabled = isReducedMotionEnabled();
  document.documentElement.dataset.reducedMotion = String(enabled);
  return enabled;
}

function subscribe(listener: () => void): () => void {
  const changed = () => listener();
  window.addEventListener(REDUCED_MOTION_EVENT, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(REDUCED_MOTION_EVENT, changed);
    window.removeEventListener("storage", changed);
  };
}

export function setReducedMotionPreference(enabled: boolean): void {
  volatilePreference = enabled;
  try {
    window.localStorage.setItem(
      REDUCED_MOTION_STORAGE_KEY,
      String(enabled),
    );
  } catch {
    // The current renderer still updates when persistent storage is blocked.
  }
  document.documentElement.dataset.reducedMotion = String(enabled);
  window.dispatchEvent(new Event(REDUCED_MOTION_EVENT));
}

export function useReducedMotionPreference(): {
  reducedMotion: boolean;
  setReducedMotion: (enabled: boolean) => void;
} {
  const reducedMotion = useSyncExternalStore(
    subscribe,
    isReducedMotionEnabled,
    () => false,
  );
  useLayoutEffect(() => {
    document.documentElement.dataset.reducedMotion =
      String(reducedMotion);
  }, [reducedMotion]);
  return {
    reducedMotion,
    setReducedMotion: useCallback(setReducedMotionPreference, []),
  };
}
