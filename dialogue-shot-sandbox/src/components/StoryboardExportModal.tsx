import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import type { DialogueStoryboardExportPreview } from "../types";

interface StoryboardExportModalProps {
  preview: DialogueStoryboardExportPreview;
  busy: boolean;
  error: string;
  result: string;
  onClose: () => void;
  onConfirm: () => void;
}

const ACTION_LABELS: Record<
  DialogueStoryboardExportPreview["nodes"][number]["action"],
  string
> = {
  create: "新增",
  replace: "覆盖",
  clear: "清空旧镜头",
  unchanged: "无需修改",
};

export function StoryboardExportModal({
  preview,
  busy,
  error,
  result,
  onClose,
  onConfirm,
}: StoryboardExportModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const blocked = preview.blockedReasons.length > 0;
  const changedNodes = preview.nodes.filter(
    (node) => node.action !== "unchanged",
  );

  return (
    <div className="modal-backdrop storyboard-export-backdrop" role="presentation">
      <section
        className="storyboard-export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storyboard-export-title"
      >
        <header>
          <div className="storyboard-export-title">
            <span>
              <Upload size={18} />
            </span>
            <div>
              <small>UE Dialog Graph 写入预检</small>
              <h2 id="storyboard-export-title">导出当前分镜</h2>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭导出预检"
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <section className="storyboard-export-summary">
          <dl>
            <div>
              <dt>对话资产</dt>
              <dd>{preview.startId}</dd>
            </div>
            <div>
              <dt>分镜</dt>
              <dd>{preview.shotCount}</dd>
            </div>
            <div>
              <dt>变更节点</dt>
              <dd>{preview.changedNodeCount}</dd>
            </div>
            <div>
              <dt>启用相机</dt>
              <dd>{preview.cameraName}</dd>
            </div>
          </dl>
          <code title={preview.dialogueAssetPath}>
            {preview.dialogueAssetPath}
          </code>
        </section>

        {(preview.blockedReasons.length > 0 ||
          preview.warnings.length > 0 ||
          error ||
          result) && (
          <div className="storyboard-export-messages">
            {preview.blockedReasons.map((reason) => (
              <p className="is-error" key={reason}>
                <AlertTriangle size={14} />
                <span>{reason}</span>
              </p>
            ))}
            {preview.warnings.map((warning) => (
              <p className="is-warning" key={warning}>
                <AlertTriangle size={14} />
                <span>{warning}</span>
              </p>
            ))}
            {error && (
              <p className="is-error" role="alert">
                <AlertTriangle size={14} />
                <span>{error}</span>
              </p>
            )}
            {result && (
              <p className="is-success" role="status">
                <CheckCircle2 size={14} />
                <span>{result}</span>
              </p>
            )}
          </div>
        )}

        <div className="storyboard-export-table-wrap">
          <table className="storyboard-export-table">
            <thead>
              <tr>
                <th>镜头</th>
                <th>台词节点</th>
                <th>节点用途</th>
                <th>当前相机</th>
                <th>导出后</th>
                <th>处理</th>
              </tr>
            </thead>
            <tbody>
              {preview.nodes.map((node) => (
                <tr
                  key={node.dialogueId}
                  data-action={node.action}
                >
                  <td>
                    {node.shotIndex === null
                      ? "-"
                      : String(node.shotIndex + 1).padStart(2, "0")}
                  </td>
                  <td>
                    <code>{node.dialogueId}</code>
                  </td>
                  <td>
                    {node.role === "shot_start" ? "镜头起点" : "镜头延续"}
                  </td>
                  <td>
                    <code>{node.existingCameraPosition || "空"}</code>
                    <small>{node.existingMovementCount} 段运镜</small>
                  </td>
                  <td>
                    <code>{node.desiredCameraPosition || "空"}</code>
                    <small>{node.desiredMovementCount} 段运镜</small>
                  </td>
                  <td>
                    <span className={`export-action export-action--${node.action}`}>
                      {ACTION_LABELS[node.action]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer>
          <label className="storyboard-export-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || blocked || Boolean(result)}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              已核对 {changedNodes.length} 个节点的覆盖内容，并确认写入后保存 UE
              对话资产
            </span>
          </label>
          <div>
            <button
              className="button"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              {result ? "完成" : "取消"}
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={onConfirm}
              disabled={
                busy ||
                blocked ||
                !confirmed ||
                Boolean(result)
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Upload size={16} />
              )}
              {busy ? "正在写入..." : "确认写入并保存"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
