import { ArrowRight, Clapperboard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface LaunchScreenProps {
  sourceName: string;
  version: string;
  onComplete: () => void;
}

export function LaunchScreen({
  sourceName,
  version,
  onComplete,
}: LaunchScreenProps) {
  const [leaving, setLeaving] = useState(false);
  const beginExit = useCallback(() => {
    setLeaving(true);
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(beginExit, reducedMotion ? 80 : 1350);
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") {
        beginExit();
      }
    };
    window.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [beginExit]);

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = window.setTimeout(onComplete, 430);
    return () => window.clearTimeout(timer);
  }, [leaving, onComplete]);

  return (
    <section
      className={`launch-screen ${leaving ? "is-leaving" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-screen-title"
    >
      <div className="launch-screen__grid" aria-hidden="true" />
      <div className="launch-screen__baseline" aria-hidden="true">
        <i />
      </div>

      <header className="launch-screen__header">
        <div className="launch-screen__brand">
          <span>
            <Clapperboard size={22} strokeWidth={2} />
          </span>
          <div>
            <strong>SHOT SANDBOX</strong>
            <small>DIALOGUE CAMERA SYSTEM</small>
          </div>
        </div>
        <span className="launch-screen__version">{version}</span>
      </header>

      <div className="launch-screen__copy">
        <p>LOCAL CAMERA WORKSPACE / 01</p>
        <h1 id="launch-screen-title">
          镜头
          <span>沙盘</span>
        </h1>
        <small title={sourceName}>{sourceName}</small>
        <button type="button" onClick={beginExit} autoFocus>
          进入工作台
          <ArrowRight size={18} />
        </button>
      </div>

      <div className="launch-screen__system-mark" aria-hidden="true">
        <span>CAM</span>
        <strong>01</strong>
        <i />
      </div>

      <footer className="launch-screen__footer">
        <span>INITIALIZING LOCAL VIEWPORT</span>
        <span>SHOT SANDBOX</span>
      </footer>
    </section>
  );
}
