import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  LoaderCircle,
  MapPinned,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { resolveMissionTargets } from "../data/missionTargetResolver";
import type {
  DialogueDatabase,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
} from "../types";
import {
  clearMissionTargetPreview,
  loadMissionTargetPreview,
} from "../ue/client";

interface MissionTargetModalProps {
  database: DialogueDatabase;
  onClose: () => void;
}

function typeLabel(type: number | null): string {
  if (type === 1) {
    return "NPC";
  }
  if (type === 2) {
    return "物件";
  }
  if (type === 3) {
    return "触发";
  }
  if (type === 4) {
    return "蓝图";
  }
  return type === null ? "未配置" : `类型 ${type}`;
}

function loadSummary(
  plan: MissionTargetPreviewPlan,
  result: MissionTargetPreviewLoadResult,
): string {
  const mapStatus = result.autoOpenedMap
    ? `已自动打开 ${plan.mapName}`
    : `当前已是 ${plan.mapName}`;
  return `${mapStatus}，加载 ${result.assetCount} 个资产和 ${result.markerCount} 个定位标记`;
}

export function MissionTargetModal({
  database,
  onClose,
}: MissionTargetModalProps) {
  const [taskId, setTaskId] = useState("");
  const [plan, setPlan] = useState<MissionTargetPreviewPlan | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const selectedCount =
    plan?.targets.filter((target) => selectedTargetIds.has(target.targetId))
      .length ?? 0;
  const allSelected =
    Boolean(plan?.targets.length) && selectedCount === plan?.targets.length;

  function inspectTask(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("");
    try {
      const nextPlan = resolveMissionTargets(database, taskId);
      setPlan(nextPlan);
      setSelectedTargetIds(
        new Set(nextPlan.targets.map((target) => target.targetId)),
      );
    } catch (resolutionError) {
      setPlan(null);
      setSelectedTargetIds(new Set());
      setError(
        resolutionError instanceof Error
          ? resolutionError.message
          : "任务目标物解析失败",
      );
    }
  }

  async function loadPreview() {
    if (!plan || selectedCount === 0) {
      return;
    }
    const selectedPlan = {
      ...plan,
      targets: plan.targets.filter((target) =>
        selectedTargetIds.has(target.targetId),
      ),
    };
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await loadMissionTargetPreview(selectedPlan);
      setStatus(loadSummary(selectedPlan, result));
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "目标物预览加载失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function clearPreview() {
    setBusy(true);
    setError("");
    try {
      const result = await clearMissionTargetPreview();
      setStatus(
        result.clearedCount > 0
          ? `已清除 ${result.clearedCount} 个目标物预览对象`
          : "当前没有需要清除的目标物预览",
      );
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : "目标物预览清理失败",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleAllTargets() {
    if (!plan) {
      return;
    }
    setSelectedTargetIds(
      allSelected
        ? new Set()
        : new Set(plan.targets.map((target) => target.targetId)),
    );
    setStatus("");
  }

  function toggleTarget(targetId: string) {
    setSelectedTargetIds((current) => {
      const next = new Set(current);
      if (next.has(targetId)) {
        next.delete(targetId);
      } else {
        next.add(targetId);
      }
      return next;
    });
    setStatus("");
  }

  return (
    <div className="modal-backdrop mission-target-backdrop" role="presentation">
      <section
        className="mission-target-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-target-title"
      >
        <header>
          <div className="mission-target-title">
            <span>
              <MapPinned size={18} />
            </span>
            <div>
              <small>UE 地图反向预览</small>
              <h2 id="mission-target-title">任务目标物</h2>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭任务目标物"
            onClick={onClose}
            disabled={busy}
          >
            <X size={17} />
          </button>
        </header>

        <form className="mission-target-query" onSubmit={inspectTask}>
          <label htmlFor="mission-task-id">任务节点 ID</label>
          <div className="input-row">
            <input
              id="mission-task-id"
              inputMode="numeric"
              value={taskId}
              onChange={(event) => {
                setTaskId(event.target.value.replace(/\D/g, "").slice(0, 12));
                setPlan(null);
                setSelectedTargetIds(new Set());
                setError("");
                setStatus("");
              }}
              placeholder="输入 Mission.id"
              autoFocus
            />
            <button
              className="icon-button"
              type="submit"
              title="解析任务目标物"
              aria-label="解析任务目标物"
              disabled={busy || !taskId}
            >
              <Search size={18} />
            </button>
          </div>
        </form>

        {error && (
          <div className="mission-target-message is-error" role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}
        {status && (
          <div className="mission-target-message is-success" role="status">
            <CheckCircle2 size={16} />
            <span>{status}</span>
          </div>
        )}

        <div className="mission-target-body">
          {plan ? (
            <>
              <section className="mission-target-summary">
                <dl>
                  <div>
                    <dt>任务节点</dt>
                    <dd>{plan.taskId}</dd>
                  </div>
                  <div>
                    <dt>任务名称</dt>
                    <dd>{plan.taskName || "未命名"}</dd>
                  </div>
                  <div>
                    <dt>配置来源</dt>
                    <dd>{plan.taskSource}</dd>
                  </div>
                  <div>
                    <dt>目标地图</dt>
                    <dd>
                      {plan.mapName} · {plan.mapId}
                    </dd>
                  </div>
                </dl>
                <code title={plan.mapAssetPath}>{plan.mapAssetPath}</code>
              </section>

              {plan.warnings.length > 0 && (
                <section className="mission-target-warnings">
                  {plan.warnings.map((warning) => (
                    <p key={warning}>
                      <AlertTriangle size={14} />
                      <span>{warning}</span>
                    </p>
                  ))}
                </section>
              )}

              <div className="mission-target-table-wrap">
                <table className="mission-target-table">
                  <thead>
                    <tr>
                      <th className="mission-target-select">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(element) => {
                            if (element) {
                              element.indeterminate =
                                selectedCount > 0 && !allSelected;
                            }
                          }}
                          onChange={toggleAllTargets}
                          aria-label="选择全部目标物"
                        />
                      </th>
                      <th>目标物</th>
                      <th>类型</th>
                      <th>NPC</th>
                      <th>模型资源</th>
                      <th>位置</th>
                      <th>旋转</th>
                      <th>预览</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.targets.map((target) => (
                      <tr key={target.targetId}>
                        <td className="mission-target-select">
                          <input
                            type="checkbox"
                            checked={selectedTargetIds.has(target.targetId)}
                            onChange={() => toggleTarget(target.targetId)}
                            aria-label={`选择目标物 ${target.targetId}`}
                          />
                        </td>
                        <td>
                          <strong>{target.targetId}</strong>
                          <small>{target.description || "未填写描述"}</small>
                        </td>
                        <td>{typeLabel(target.type)}</td>
                        <td>
                          {target.npcId && target.npcId > 0
                            ? `${target.npcName || "未知 NPC"} · ${target.npcId}`
                            : "N/A"}
                        </td>
                        <td title={target.modelClassPath}>
                          {target.modelId
                            ? `${target.modelId} · ${target.modelClassPath.split("/").at(-1)}`
                            : "N/A"}
                        </td>
                        <td>
                          <code>
                            {[
                              target.transform.location.x,
                              target.transform.location.y,
                              target.transform.location.z,
                            ]
                              .map((value) => value.toFixed(0))
                              .join(", ")}
                          </code>
                        </td>
                        <td>
                          <code>
                            {[
                              target.transform.rotation.pitch,
                              target.transform.rotation.yaw,
                              target.transform.rotation.roll,
                            ]
                              .map((value) => `${value.toFixed(0)}°`)
                              .join(", ")}
                          </code>
                        </td>
                        <td>
                          <span
                            className={`preview-kind preview-kind--${target.previewKind}`}
                          >
                            {target.previewKind === "asset"
                              ? "实际资产"
                              : "定位标记"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="mission-target-empty">
              <Boxes size={28} />
              <strong>尚未解析任务节点</strong>
              <small>
                当前数据源包含 {database.missionRows.length.toLocaleString()}{" "}
                个任务节点
              </small>
            </div>
          )}
        </div>

        <footer>
          <span>
            {plan
              ? `已选择 ${selectedCount} / ${plan.targets.length} 个目标物，MapID ${plan.mapId}`
              : "解析不会修改配置或 UE 关卡"}
          </span>
          <div>
            <button
              className="button"
              type="button"
              onClick={() => void clearPreview()}
              disabled={busy}
            >
              <Trash2 size={15} />
              清除预览
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => void loadPreview()}
              disabled={busy || !plan || selectedCount === 0}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <MapPinned size={16} />
              )}
              {busy ? "正在处理..." : "加载到 UE"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
