import { useEffect, useState } from "react";
import type { ConfigurationActivity } from "../configurationActivity";

const pending: ConfigurationActivity = {
  state: "unknown", message: "正在识别工作窗口，暂缓 UE 自动读取",
};

type ManualReadMode = "automatic" | "paused" | "active";

export function useConfigurationActivity(enabled: boolean) {
  const supported = Boolean(window.shotSandboxDesktop?.monitorConfigurationActivity);
  const [manualReadMode, setManualReadMode] =
    useState<ManualReadMode>("automatic");
  const monitoring = enabled && supported;
  const [session, setSession] = useState({ monitoring: false, activity: pending });
  // A newly enabled monitor must not reuse the previous dialogue window before
  // the effect subscribes. This also covers re-entering compact mode.
  const activity = session.monitoring === monitoring ? session.activity : pending;
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    const desktop = window.shotSandboxDesktop;
    setSession({ monitoring, activity: pending });
    if (!monitoring || !desktop?.monitorConfigurationActivity) return;
    let active = true;
    let received = false;
    const setActivity = (activity: ConfigurationActivity) => setSession({ monitoring, activity });
    const remove = desktop.onConfigurationActivity?.((snapshot) => {
      received = true;
      if (active) setActivity(snapshot);
    });
    void desktop.monitorConfigurationActivity(true).then((snapshot) => {
      if (active && !received) setActivity(snapshot);
    }).catch(() => {
      if (active) setActivity({ state: "unknown", message: "窗口识别不可用，已暂停 UE 自动读取" });
    });
    return () => {
      active = false;
      remove?.();
      void desktop.monitorConfigurationActivity!(false).catch(() => {});
    };
  }, [monitoring]);
  useEffect(() => {
    if (!enabled) {
      setManualReadMode("automatic");
    }
  }, [enabled]);
  useEffect(() => {
    if (
      manualReadMode === "active" &&
      activity.state === "dialogue"
    ) {
      setManualReadMode("automatic");
    }
  }, [activity.state, manualReadMode]);
  const manualPaused = manualReadMode === "paused";
  const manualActive = manualReadMode === "active";
  const automaticPaused =
    enabled && (!visible || (supported && activity.state !== "dialogue"));
  const paused =
    enabled &&
    (
      manualPaused ||
      !visible ||
      (!manualActive && supported && activity.state !== "dialogue")
    );
  return {
    supported,
    manualPaused,
    manualActive,
    automaticPaused,
    paused,
    toggleManualPause: () =>
      setManualReadMode(paused ? "active" : "paused"),
    message: manualPaused
      ? "已手动暂停 UE 自动读取"
      : !visible
        ? "窗口已隐藏，已暂停 UE 自动读取"
        : activity.message,
  };
}
