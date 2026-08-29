import {
  Check,
  CircleAlert,
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
        <button
          className="icon-button desktop-first-run__close"
          type="button"
          title="暂时跳过"
          aria-label="暂时跳过首次设置"
          onClick={onSkip}
        >
          <X size={17} />
        </button>

        <div className="desktop-first-run__body">
          <small>首次启动</small>
          <h2 id="desktop-first-run-title">配置项目数据目录</h2>
          <p>
            选择项目的 res 和 doc 根目录。实时 CSV 与配置 CSV
            会按项目统一结构自动定位。
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
              选择 res 目录
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={onChooseConfigDirectory}
            >
              <FolderOpen size={17} />
              选择 doc 目录
            </button>
          </div>

          <div className="desktop-first-run__selections">
            {[
              {
                ready: status.liveDataReady ?? status.defaultDataReady,
                title: "res 实时数据",
                path:
                  status.liveResDirectory ?? "",
                fallback: "固定读取 Content\\Seria\\Tables\\csvdir",
              },
              {
                ready: status.configDataReady ?? status.defaultDataReady,
                title: "doc 配置文档",
                path:
                  status.configDocDirectory ?? "",
                fallback: "固定读取 csvdir，并从 xlsdir 写入 Excel",
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
