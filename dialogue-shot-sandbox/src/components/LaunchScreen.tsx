import { Clapperboard, LoaderCircle } from "lucide-react";
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
    return () => window.clearTimeout(timer);
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
        <div className="launch-screen__loading" role="status">
          <LoaderCircle className="spin" size={17} />
          <span>Loading</span>
        </div>
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
