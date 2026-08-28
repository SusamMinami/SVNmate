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
  onChooseDirectory: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

export function DesktopFirstRunModal({
  status,
  busy,
  error,
  onChooseDirectory,
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
          <h2 id="desktop-first-run-title">选择对话数据目录</h2>
          <p>
            选择项目的 doc 文件夹。它可以位于任意磁盘或目录，应用会读取其中的
            csvdir。
          </p>

          <button
            className="button button--primary desktop-first-run__choose"
            type="button"
            disabled={busy}
            onClick={onChooseDirectory}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <FolderOpen size={17} />
            )}
            {busy ? "正在读取" : "选择 doc 文件夹"}
          </button>

          <div
            className={`desktop-first-run__selection ${
              status.defaultDataReady ? "is-ready" : ""
            }`}
            role="status"
          >
            {status.defaultDataReady ? (
              <Check size={17} />
            ) : (
              <CircleAlert size={17} />
            )}
            <span>
              <strong>
                {status.defaultDataReady ? "对话数据已就绪" : "尚未选择目录"}
              </strong>
              <small title={status.dataCsvDirectory || undefined}>
                {status.defaultDataReady
                  ? status.dataCsvDirectory
                  : "也可以直接选择 csvdir 文件夹"}
              </small>
            </span>
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
                : "请先选择有效的 doc 文件夹"
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
