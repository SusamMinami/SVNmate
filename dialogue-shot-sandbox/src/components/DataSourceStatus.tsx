import {
  CircleCheck,
  Database,
  LoaderCircle,
  LogIn,
  RefreshCw,
  Settings,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LarkStatus } from "../lark/client";

interface DataSourceStatusProps {
  sourceName: string;
  dialogueCount: number;
  npcCount: number;
  setupStatus: DesktopSetupStatus | null;
  larkLoading: boolean;
  larkStatus: LarkStatus | null;
  larkError: string;
  collectRevisionCases: boolean;
  onOpenSettings?: () => void;
  onRefreshLark: () => void;
  onAuthorize: () => void;
  onCollectRevisionCasesChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export function DataSourceStatus({
  sourceName,
  dialogueCount,
  npcCount,
  setupStatus,
  larkLoading,
  larkStatus,
  larkError,
  collectRevisionCases,
  onOpenSettings,
  onRefreshLark,
  onAuthorize,
  onCollectRevisionCasesChange,
  disabled = false,
}: DataSourceStatusProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const directoryReady = setupStatus?.defaultDataReady ?? true;
  const baseMissingScopes =
    larkStatus?.baseMissingScopes ?? larkStatus?.missingScopes ?? [];
  const caseLibraryReady =
    larkStatus?.caseLibraryReady ??
    (Boolean(larkStatus?.authorized) && baseMissingScopes.length === 0);
  const caseLibraryAvailable = caseLibraryReady && !larkError;
  const needsAuthorization =
    !larkStatus?.authorized || baseMissingScopes.length > 0;
  const caseStatusLabel = !collectRevisionCases
    ? "返修案例收集已关闭"
    : larkLoading
      ? "正在检查返修案例库"
      : larkError
        ? "飞书桥不可用"
        : caseLibraryAvailable
          ? "返修案例库已连接"
          : baseMissingScopes.length > 0
            ? `缺少 ${baseMissingScopes.length} 项多维表格权限`
            : larkStatus?.authorized
              ? "返修案例库尚未连接"
              : "飞书未登录";
  const caseDetail = !collectRevisionCases
    ? "本次不读取或写入案例库"
    : caseLibraryAvailable
      ? "失败返修将写入待审核，并参考已通过案例"
      : !larkStatus?.authorized
        ? "需要登录飞书后访问案例库"
        : baseMissingScopes.length > 0
          ? "需要补充飞书多维表格权限"
          : "刷新连接以重新检查案例库";
  const dataState = !directoryReady
    ? "warning"
    : collectRevisionCases && larkLoading
      ? "loading"
      : collectRevisionCases && !caseLibraryAvailable
        ? "warning"
        : "ready";
  const statusLabel = !directoryReady
    ? "数据目录配置不完整"
    : dataState === "loading"
      ? "正在检查返修案例库"
      : collectRevisionCases && !caseLibraryAvailable
        ? caseStatusLabel
        : "数据源已就绪";

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

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
        data-state={dataState}
        type="button"
        aria-label="数据源状态"
        aria-haspopup="dialog"
        aria-expanded={!disabled && open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Database size={17} />
        <span className="workspace-status-tooltip">{statusLabel}</span>
      </button>

      {open && !disabled && (
        <section
          className="workspace-status-popover data-source-status__popover"
          data-state={dataState}
          role="dialog"
          aria-label="数据源配置"
        >
          <header>
            <span>
              {dataState === "loading" ? (
                <LoaderCircle className="spin" size={17} />
              ) : dataState === "ready" ? (
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
          </dl>

          <label className="workspace-status-toggle data-source-status__case">
            <input
              type="checkbox"
              checked={collectRevisionCases}
              onChange={(event) =>
                onCollectRevisionCasesChange(event.target.checked)
              }
            />
            <span>
              <strong>收集返修案例</strong>
              <small>
                {caseStatusLabel} · {caseDetail}
              </small>
            </span>
          </label>

          <div className="data-source-status__actions">
            {collectRevisionCases && (
              <button
                className="button"
                type="button"
                disabled={larkLoading}
                onClick={needsAuthorization ? onAuthorize : onRefreshLark}
              >
                {larkLoading ? (
                  <LoaderCircle className="spin" size={14} />
                ) : needsAuthorization ? (
                  <LogIn size={14} />
                ) : (
                  <RefreshCw size={14} />
                )}
                {needsAuthorization ? "登录飞书" : "刷新案例库"}
              </button>
            )}
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
          </div>
        </section>
      )}
    </div>
  );
}
