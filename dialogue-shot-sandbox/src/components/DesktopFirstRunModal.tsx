import {
  Check,
  CircleAlert,
  Clapperboard,
  FolderOpen,
  LoaderCircle,
  X,
} from "lucide-react";

interface DesktopFirstRunModalProps {
  status: DesktopSetupStatus;
  busy: boolean;
  error: string;
  onChooseLiveDirectory: () => void;
  onChooseConfigDirectory: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

export function DesktopFirstRunModal({
  status,
  busy,
  error,
  onChooseLiveDirectory,
  onChooseConfigDirectory,
  onComplete,
  onSkip,
}: DesktopFirstRunModalProps) {
  return (
    <div className="modal-backdrop desktop-first-run-backdrop" role="presentation">
      <section
        className="desktop-first-run"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-first-run-title"
      >
        <header>
          <div className="desktop-first-run__brand" aria-hidden="true">
            <Clapperboard size={19} />
            <span>SHOT SANDBOX</span>
          </div>
          <button
            className="icon-button"
            type="button"
            title="暂时跳过"
            aria-label="暂时跳过首次设置"
            onClick={onSkip}
          >
            <X size={17} />
          </button>
        </header>

        <div className="desktop-first-run__body">
          <small>首次启动</small>
          <h2 id="desktop-first-run-title">配置项目数据目录</h2>
          <p>
            实时数据可指向引擎导出的 res；配置文档指向稳定的 doc/csvdir，
            用于 NPC、模型、目标物和地图数据及 Excel 写入。
          </p>

          <div className="desktop-first-run__directory-actions">
            <button
              className="button button--primary"
              type="button"
              disabled={busy}
              onClick={onChooseLiveDirectory}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <FolderOpen size={17} />
              )}
              选择实时数据目录
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={onChooseConfigDirectory}
            >
              <FolderOpen size={17} />
              选择配置文档目录
            </button>
          </div>

          <div className="desktop-first-run__selections">
            {[
              {
                ready: status.liveDataReady ?? status.defaultDataReady,
                title: "实时数据",
                path:
                  status.liveCsvDirectory ??
                  status.dataCsvDirectory ??
                  "",
                fallback: "对话表、开始节点、任务表",
              },
              {
                ready: status.configDataReady ?? status.defaultDataReady,
                title: "配置文档",
                path:
                  status.configCsvDirectory ??
                  status.dataCsvDirectory ??
                  "",
                fallback: "NPC、模型、目标物、地图表",
              },
            ].map((item) => (
              <div
                key={item.title}
                className={`desktop-first-run__selection ${
                  item.ready ? "is-ready" : ""
                }`}
                role="status"
              >
                {item.ready ? (
                  <Check size={17} />
                ) : (
                  <CircleAlert size={17} />
                )}
                <span>
                  <strong>
                    {item.title} · {item.ready ? "已就绪" : "待选择"}
                  </strong>
                  <small title={item.path || undefined}>
                    {item.path || item.fallback}
                  </small>
                </span>
              </div>
            ))}
          </div>

          {error && (
            <div className="inline-error" role="alert">
              <CircleAlert size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer>
          <button className="button" type="button" onClick={onSkip}>
            暂时跳过
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={busy || !status.defaultDataReady}
            title={
              status.defaultDataReady
                ? "保存目录并开始使用"
                : "请先完成两个数据目录"
            }
            onClick={onComplete}
          >
            开始使用
          </button>
        </footer>
      </section>
    </div>
  );
}
