import {
  CircleCheck,
  Database,
  Settings,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface DataSourceStatusProps {
  sourceName: string;
  dialogueCount: number;
  npcCount: number;
  setupStatus: DesktopSetupStatus | null;
  onOpenSettings?: () => void;
}

export function DataSourceStatus({
  sourceName,
  dialogueCount,
  npcCount,
  setupStatus,
  onOpenSettings,
}: DataSourceStatusProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ready = setupStatus?.defaultDataReady ?? true;
  const statusLabel = ready ? "数据源已就绪" : "数据源配置不完整";

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="data-source-status" ref={rootRef}>
      <button
        className="workspace-status-icon"
        data-state={ready ? "ready" : "warning"}
        type="button"
        aria-label="数据源状态"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Database size={17} />
        <span className="workspace-status-tooltip">{statusLabel}</span>
      </button>

      {open && (
        <section
          className="workspace-status-popover data-source-status__popover"
          data-state={ready ? "ready" : "warning"}
          role="dialog"
          aria-label="数据源配置"
        >
          <header>
            <span>
              {ready ? (
                <CircleCheck size={17} />
              ) : (
                <ShieldAlert size={17} />
              )}
            </span>
            <div>
              <small>当前数据源</small>
              <strong>{statusLabel}</strong>
            </div>
          </header>

          <dl className="data-source-status__details">
            <div>
              <dt>数据概览</dt>
              <dd>
                {dialogueCount.toLocaleString()} 条台词 ·{" "}
                {npcCount.toLocaleString()} 个 NPC
              </dd>
            </div>
            <div>
              <dt>数据来源</dt>
              <dd title={sourceName}>{sourceName}</dd>
            </div>
            {setupStatus && (
              <>
                <div>
                  <dt>实时数据</dt>
                  <dd title={setupStatus.liveResDirectory}>
                    {setupStatus.liveResDirectory || "未配置"}
                  </dd>
                </div>
                <div>
                  <dt>配置文档</dt>
                  <dd title={setupStatus.configDocDirectory}>
                    {setupStatus.configDocDirectory || "未配置"}
                  </dd>
                </div>
                {setupStatus.missionTargetTablePath && (
                  <div>
                    <dt>目标物表</dt>
                    <dd title={setupStatus.missionTargetTablePath}>
                      {setupStatus.missionTargetTablePath}
                    </dd>
                  </div>
                )}
              </>
            )}
          </dl>

          {onOpenSettings && (
            <button
              className="button"
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Settings size={14} />
              打开设置
            </button>
          )}
        </section>
      )}
    </div>
  );
}
