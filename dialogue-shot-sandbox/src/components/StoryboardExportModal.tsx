import {
  AlertTriangle,
  CheckCircle2,
  Layers3,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DialogueStoryboardExportPreview } from "../types";

interface StoryboardExportModalProps {
  preview: DialogueStoryboardExportPreview;
  mode: "current" | "all";
  currentShotNumber: number;
  busy: boolean;
  error: string;
  result: string;
  onClose: () => void;
  onShowAll: () => void;
  onConfirm: (selectedShotIndexes: number[]) => void;
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
  mode,
  currentShotNumber,
  busy,
  error,
  result,
  onClose,
  onShowAll,
  onConfirm,
}: StoryboardExportModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [selectedShotIndexes, setSelectedShotIndexes] = useState<number[]>(
    () => Array.from({ length: preview.shotCount }, (_, index) => index),
  );
  const selectedShots = new Set(selectedShotIndexes);
  const selectedNodes = preview.nodes.filter((node) =>
    selectedShots.has(node.shotIndex),
  );
  const changedNodes = selectedNodes.filter(
    (node) => node.action !== "unchanged",
  );
  const selectedBlockedReasons = [
    ...preview.globalBlockedReasons,
    ...preview.shots
      .filter((shot) => selectedShots.has(shot.shotIndex))
      .flatMap((shot) => shot.blockedReasons),
  ];
  const selectedInvalidShotCount = preview.shots.filter(
    (shot) =>
      selectedShots.has(shot.shotIndex) && !shot.projectionValid,
  ).length;
  const selectedWarnings = selectedInvalidShotCount
    ? [
        `${selectedInvalidShotCount} 个镜头的投影验收未通过，确认后仍可导出`,
      ]
    : [];
  const blocked = selectedBlockedReasons.length > 0;
  const allSelected = selectedShotIndexes.length === preview.shotCount;

  useEffect(() => {
    setSelectedShotIndexes(
      Array.from({ length: preview.shotCount }, (_, index) => index),
    );
    setConfirmed(false);
  }, [preview.reviewToken]);

  function selectAllShots(checked: boolean) {
    setSelectedShotIndexes(
      checked
        ? Array.from({ length: preview.shotCount }, (_, index) => index)
        : [],
    );
    setConfirmed(false);
  }

  function selectShot(shotIndex: number, checked: boolean) {
    setSelectedShotIndexes((current) =>
      checked
        ? [...current, shotIndex].sort((left, right) => left - right)
        : current.filter((index) => index !== shotIndex),
    );
    setConfirmed(false);
  }

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
              <h2 id="storyboard-export-title">
                {mode === "current"
                  ? `导出当前镜头 ${String(currentShotNumber).padStart(2, "0")}`
                  : "导出全部分镜"}
              </h2>
            </div>
          </div>
          <div className="storyboard-export-header-actions">
            {mode === "current" && (
              <button
                className="button storyboard-export-all-button"
                type="button"
                onClick={onShowAll}
                disabled={busy || Boolean(result)}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Layers3 size={15} />
                )}
                全部导出
              </button>
            )}
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
          </div>
        </header>

        <section className="storyboard-export-summary">
          <dl>
            <div>
              <dt>对话资产</dt>
              <dd>{preview.startId}</dd>
            </div>
            <div>
              <dt>分镜</dt>
              <dd>
                {mode === "current"
                  ? String(currentShotNumber).padStart(2, "0")
                  : `${selectedShotIndexes.length} / ${preview.shotCount}`}
              </dd>
            </div>
            <div>
              <dt>变更节点</dt>
              <dd>{changedNodes.length}</dd>
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

        {(selectedBlockedReasons.length > 0 ||
          selectedWarnings.length > 0 ||
          error ||
          result) && (
          <div className="storyboard-export-messages">
            {selectedBlockedReasons.map((reason) => (
              <p className="is-error" key={reason}>
                <AlertTriangle size={14} />
                <span>{reason}</span>
              </p>
            ))}
            {selectedWarnings.map((warning) => (
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
                {mode === "all" && (
                  <th className="storyboard-export-table__select">
                    <input
                      type="checkbox"
                      aria-label="选择全部镜头"
                      title="选择全部镜头"
                      checked={allSelected}
                      disabled={busy || Boolean(result)}
                      onChange={(event) =>
                        selectAllShots(event.target.checked)
                      }
                    />
                  </th>
                )}
                <th className="storyboard-export-table__shot">镜头</th>
                <th className="storyboard-export-table__dialogue">台词节点</th>
                <th className="storyboard-export-table__role">节点用途</th>
                <th className="storyboard-export-table__camera">当前相机</th>
                <th className="storyboard-export-table__camera">导出后</th>
                <th className="storyboard-export-table__action">处理</th>
              </tr>
            </thead>
            <tbody>
              {preview.nodes.map((node) => (
                <tr
                  key={node.dialogueId}
                  data-action={node.action}
                  data-selected={selectedShots.has(node.shotIndex)}
                >
                  {mode === "all" && (
                    <td className="storyboard-export-table__select">
                      {node.role === "shot_start" && (
                        <input
                          type="checkbox"
                          aria-label={`选择镜头 ${String(node.shotIndex + 1).padStart(2, "0")}`}
                          checked={selectedShots.has(node.shotIndex)}
                          disabled={busy || Boolean(result)}
                          onChange={(event) =>
                            selectShot(
                              node.shotIndex,
                              event.target.checked,
                            )
                          }
                        />
                      )}
                    </td>
                  )}
                  <td>
                    {node.role === "shot_start"
                      ? String(
                          mode === "current"
                            ? currentShotNumber
                            : node.shotIndex + 1,
                        ).padStart(2, "0")
                      : "↳"}
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
              disabled={
                busy ||
                blocked ||
                selectedShotIndexes.length === 0 ||
                Boolean(result)
              }
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
              disabled={
                busy ||
                blocked ||
                selectedShotIndexes.length === 0 ||
                !confirmed ||
                Boolean(result)
              }
              onClick={() => onConfirm(selectedShotIndexes)}
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
