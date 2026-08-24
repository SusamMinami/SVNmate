import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  FileSearch,
  Link2,
  LoaderCircle,
  MapPinned,
  MonitorUp,
  PackagePlus,
  PencilLine,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { NpcRegistrationModal } from "./NpcRegistrationModal";
import { resolveMissionTargets } from "../data/missionTargetResolver";
import type {
  DialogueModelRegistrationSlot,
  DialogueDatabase,
  MissionTargetBlueprintInspection,
  MissionTargetEditRequest,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
  MissionTargetUpdateItem,
} from "../types";
import {
  clearMissionTargetPreview,
  checkMissionTargetBlueprint,
  createMissionTargetBlueprint,
  inspectMissionTargetMap,
  inspectMissionTargetBlueprint,
  loadMissionTargetPreview,
  registerBlueprintDialogueModels,
} from "../ue/client";

interface MissionTargetModalProps {
  database: DialogueDatabase;
  onClose: () => void;
}

interface MapLoadDecision {
  plan: MissionTargetPreviewPlan;
  currentMapAssetPath: string;
  phase: "choose" | "manual";
  error: string;
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

function dialogueModelLabel(
  slot: DialogueModelRegistrationSlot | undefined,
  selected: boolean,
): { name: string; status: string; tone: string } {
  if (!selected) {
    return { name: "None", status: "保持为空", tone: "empty" };
  }
  if (!slot) {
    return { name: "-", status: "未检查", tone: "empty" };
  }
  if (slot.status === "unmapped") {
    return { name: "None", status: "未登记", tone: "warning" };
  }
  if (slot.status === "registered") {
    return {
      name: slot.existingModelName,
      status: "已注册",
      tone: "registered",
    };
  }
  return {
    name: slot.suggestedModelName ?? "None",
    status: "待注册",
    tone: "pending",
  };
}

export function MissionTargetModal({
  database,
  onClose,
}: MissionTargetModalProps) {
  const [taskId, setTaskId] = useState("");
  const [blueprintName, setBlueprintName] = useState("");
  const [plan, setPlan] = useState<MissionTargetPreviewPlan | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(
    new Set(),
  );
  const [blueprintInspection, setBlueprintInspection] =
    useState<MissionTargetBlueprintInspection | null>(null);
  const [selectedModelIndexes, setSelectedModelIndexes] = useState<
    Set<number>
  >(new Set());
  const [editRequest, setEditRequest] =
    useState<MissionTargetEditRequest | null>(null);
  const [mapLoadDecision, setMapLoadDecision] =
    useState<MapLoadDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const selectedCount =
    plan?.targets.filter((target) => selectedTargetIds.has(target.targetId))
      .length ?? 0;
  const allSelected =
    Boolean(plan?.targets.length) && selectedCount === plan?.targets.length;
  const selectedAssetTargets =
    plan?.targets.filter(
      (target) =>
        selectedTargetIds.has(target.targetId) &&
        target.previewKind === "asset" &&
        Boolean(target.modelClassPath),
    ) ?? [];
  const blueprintModelSlots =
    blueprintInspection?.slots.filter((slot) => slot.modelIndex > 0) ?? [];
  const selectedModelCount = blueprintModelSlots.filter((slot) =>
    selectedModelIndexes.has(slot.modelIndex),
  ).length;
  const allBlueprintModelsSelected =
    blueprintModelSlots.length > 0 &&
    selectedModelCount === blueprintModelSlots.length;
  const isDialogueRegistration =
    blueprintInspection?.blueprintState === "populated";

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
      setBlueprintInspection(null);
      setSelectedModelIndexes(new Set());
    } catch (resolutionError) {
      setPlan(null);
      setSelectedTargetIds(new Set());
      setBlueprintInspection(null);
      setSelectedModelIndexes(new Set());
      setError(
        resolutionError instanceof Error
          ? resolutionError.message
          : "任务目标物解析失败",
      );
    }
  }

  async function executePreviewLoad(
    selectedPlan: MissionTargetPreviewPlan,
    mapMode: "require-current" | "auto",
  ) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await loadMissionTargetPreview(selectedPlan, mapMode);
      setMapLoadDecision(null);
      setStatus(loadSummary(selectedPlan, result));
    } catch (previewError) {
      const message =
        previewError instanceof Error
          ? previewError.message
          : "目标物预览加载失败";
      if (mapLoadDecision) {
        setMapLoadDecision((current) =>
          current ? { ...current, error: message } : current,
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
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
      const mapStatus = await inspectMissionTargetMap(
        selectedPlan.mapAssetPath,
      );
      if (mapStatus.matches) {
        const result = await loadMissionTargetPreview(
          selectedPlan,
          "require-current",
        );
        setStatus(loadSummary(selectedPlan, result));
      } else {
        setMapLoadDecision({
          plan: selectedPlan,
          currentMapAssetPath: mapStatus.currentMapAssetPath,
          phase: "choose",
          error: "",
        });
      }
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

  async function verifyManualMapAndLoad() {
    if (!mapLoadDecision) {
      return;
    }
    setBusy(true);
    setMapLoadDecision((current) =>
      current ? { ...current, error: "" } : current,
    );
    try {
      const mapStatus = await inspectMissionTargetMap(
        mapLoadDecision.plan.mapAssetPath,
      );
      if (!mapStatus.matches) {
        setMapLoadDecision((current) =>
          current
            ? {
                ...current,
                currentMapAssetPath: mapStatus.currentMapAssetPath,
                error: "UE 尚未完成目标地图切换",
              }
            : current,
        );
        return;
      }
      const result = await loadMissionTargetPreview(
        mapLoadDecision.plan,
        "require-current",
      );
      setMapLoadDecision(null);
      setStatus(loadSummary(mapLoadDecision.plan, result));
    } catch (previewError) {
      setMapLoadDecision((current) =>
        current
          ? {
              ...current,
              error:
                previewError instanceof Error
                  ? previewError.message
                  : "目标物预览加载失败",
            }
          : current,
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

  async function inspectBlueprint() {
    if (!blueprintName.trim()) {
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan ?? undefined,
      );
      setBlueprintInspection(inspection);
      setSelectedModelIndexes(
        new Set(
          inspection.slots
            .filter((slot) => slot.modelIndex > 0)
            .map((slot) => slot.modelIndex),
        ),
      );
      setStatus(inspection.message);
    } catch (inspectionError) {
      setBlueprintInspection(null);
      setSelectedModelIndexes(new Set());
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : "BP 与对话配置检查失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createBlueprint() {
    if (
      !plan ||
      !blueprintName.trim() ||
      blueprintInspection?.blueprintState !== "empty" ||
      selectedAssetTargets.length === 0
    ) {
      return;
    }
    const selectedPlan = {
      ...plan,
      targets: selectedAssetTargets,
    };
    const clearingRegistered = blueprintInspection.slots.filter(
      (slot) =>
        slot.modelIndex > 0 &&
        slot.status === "registered" &&
        slot.targetId &&
        !selectedTargetIds.has(slot.targetId),
    );
    if (
      clearingRegistered.length > 0 &&
      !window.confirm(
        `未勾选的已注册槽位 ${clearingRegistered
          .map((slot) => slot.modelIndex)
          .join("、")} 将改为 None，是否继续创建 BP？`,
      )
    ) {
      setStatus("已取消创建 BP");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const compatibility = await checkMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        selectedPlan.targets.map((target) => target.targetId),
      );
      if (
        compatibility.status !== "matched" &&
        !window.confirm(
          `${compatibility.message}\n\n创建 BP 将同步更新对话 Formation 和 DialogModels，是否继续？`,
        )
      ) {
        setStatus("已取消创建 BP");
        return;
      }
      const result = await createMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        selectedPlan.targets.map((target) => target.targetId),
        true,
      );
      const registration = result.dialogueRegistration;
      setStatus(
        `已创建 ${result.blueprintAssetPath}：0 号玩家、${result.targetCount} 个目标物和 c1 摄像机；对话模型 ${
          registration?.registeredCount ?? 0
        } 个，None ${registration?.emptyCount ?? 0} 个`,
      );
      try {
        const inspection = await inspectMissionTargetBlueprint(
          blueprintName.trim(),
        );
        setBlueprintInspection(inspection);
        setSelectedModelIndexes(
          new Set(
            inspection.slots
              .filter((slot) => slot.modelIndex > 0)
              .map((slot) => slot.modelIndex),
          ),
        );
      } catch {
        setBlueprintInspection(null);
      }
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "创建 BP 内容失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function registerDialogue() {
    if (
      !blueprintName.trim() ||
      blueprintInspection?.blueprintState !== "populated"
    ) {
      return;
    }
    const clearingRegistered = blueprintModelSlots.filter(
      (slot) =>
        slot.status === "registered" &&
        !selectedModelIndexes.has(slot.modelIndex),
    );
    if (
      clearingRegistered.length > 0 &&
      !window.confirm(
        `未勾选的已注册槽位 ${clearingRegistered
          .map((slot) => slot.modelIndex)
          .join("、")} 将改为 None，是否继续？`,
      )
    ) {
      setStatus("已取消注册到对话");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await registerBlueprintDialogueModels(
        blueprintName.trim(),
        Array.from(selectedModelIndexes).sort(
          (left, right) => left - right,
        ),
      );
      const unresolved = result.unresolvedIndexes.length
        ? `；槽位 ${result.unresolvedIndexes.join("、")} 未在 DialogNPCTable 登记，保持 None`
        : "";
      setStatus(
        `${result.status === "unchanged" ? "对话模型无需变更" : `已注册到对话 ${result.dialogueId}`}：模型 ${result.registeredCount} 个，None ${result.emptyCount} 个${unresolved}`,
      );
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
      );
      setBlueprintInspection(inspection);
    } catch (registrationError) {
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "注册 DialogModels 失败",
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

  function toggleAllBlueprintModels() {
    setSelectedModelIndexes(
      allBlueprintModelsSelected
        ? new Set()
        : new Set(blueprintModelSlots.map((slot) => slot.modelIndex)),
    );
    setStatus("");
  }

  function toggleBlueprintModel(modelIndex: number) {
    setSelectedModelIndexes((current) => {
      const next = new Set(current);
      if (next.has(modelIndex)) {
        next.delete(modelIndex);
      } else {
        next.add(modelIndex);
      }
      return next;
    });
    setStatus("");
  }

  function openTargetEditor() {
    if (!plan || selectedCount === 0) {
      return;
    }
    setEditRequest({
      taskId: plan.taskId,
      mapId: plan.mapId,
      mapAssetPath: plan.mapAssetPath,
      targets: plan.targets.filter((target) =>
        selectedTargetIds.has(target.targetId),
      ),
    });
  }

  function applyTargetUpdates(items: MissionTargetUpdateItem[]) {
    const updates = new Map(
      items.map((item) => [item.targetId, item.transform]),
    );
    const updateTargets = (
      targets: MissionTargetPreviewPlan["targets"],
    ): MissionTargetPreviewPlan["targets"] =>
      targets.map((target) => {
        const transform = updates.get(target.targetId);
        return transform
          ? {
              ...target,
              transform: {
                ...target.transform,
                location: transform.location,
                rotation: transform.rotation,
              },
            }
          : target;
      });
    setPlan((current) =>
      current
        ? { ...current, targets: updateTargets(current.targets) }
        : current,
    );
    setEditRequest((current) =>
      current
        ? {
            ...current,
            targets: updateTargets(current.targets),
          }
        : current,
    );
    setStatus(`已修改 ${items.length} 个目标物的位置或旋转（Excel 未保存）`);
  }

  if (editRequest) {
    return (
      <NpcRegistrationModal
        editRequest={editRequest}
        onTargetsUpdated={applyTargetUpdates}
        onClose={() => setEditRequest(null)}
      />
    );
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
              <small>UE 目标物与镜头 Blueprint</small>
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
              disabled={busy}
              onChange={(event) => {
                setTaskId(event.target.value.replace(/\D/g, "").slice(0, 12));
                setPlan(null);
                setSelectedTargetIds(new Set());
                setBlueprintInspection(null);
                setSelectedModelIndexes(new Set());
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
          <label htmlFor="mission-blueprint-name">BP 文件名</label>
          <div className="input-row">
            <input
              id="mission-blueprint-name"
              value={blueprintName}
              disabled={busy}
              onChange={(event) => {
                setBlueprintName(event.target.value);
                setBlueprintInspection(null);
                setSelectedModelIndexes(new Set());
                setError("");
                setStatus("");
              }}
              placeholder="BP_735100 或 /Game/.../BP_735100"
              spellCheck={false}
            />
            <button
              className="icon-button"
              type="button"
              title="检查 BP 与对话模型"
              aria-label="检查 BP 与对话模型"
              onClick={() => void inspectBlueprint()}
              disabled={busy || !blueprintName.trim()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <FileSearch size={18} />
              )}
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
          {isDialogueRegistration && blueprintInspection ? (
            <>
              <section className="mission-target-summary mission-target-summary--blueprint">
                <dl>
                  <div>
                    <dt>Blueprint</dt>
                    <dd>{blueprintInspection.blueprintAssetPath.split("/").at(-1)}</dd>
                  </div>
                  <div>
                    <dt>对话文件</dt>
                    <dd>{blueprintInspection.dialogueId}</dd>
                  </div>
                  <div>
                    <dt>模型槽位</dt>
                    <dd>{blueprintModelSlots.length}</dd>
                  </div>
                  <div>
                    <dt>已注册</dt>
                    <dd>
                      {
                        blueprintModelSlots.filter(
                          (slot) => slot.status === "registered",
                        ).length
                      }
                    </dd>
                  </div>
                </dl>
                <code title={blueprintInspection.dialogueAssetPath ?? ""}>
                  {blueprintInspection.dialogueAssetPath}
                </code>
              </section>
              <div className="mission-target-table-wrap">
                <table className="mission-target-table mission-target-dialogue-table">
                  <thead>
                    <tr>
                      <th className="mission-target-select">
                        <input
                          type="checkbox"
                          checked={allBlueprintModelsSelected}
                          ref={(element) => {
                            if (element) {
                              element.indeterminate =
                                selectedModelCount > 0 &&
                                !allBlueprintModelsSelected;
                            }
                          }}
                          onChange={toggleAllBlueprintModels}
                          aria-label="选择全部 BP 模型"
                        />
                      </th>
                      <th>槽位</th>
                      <th>BP 模型资源</th>
                      <th>DialogNPCTable 名称</th>
                      <th>对话状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blueprintModelSlots.map((slot) => {
                      const selected = selectedModelIndexes.has(
                        slot.modelIndex,
                      );
                      const label = dialogueModelLabel(slot, selected);
                      return (
                        <tr key={slot.modelIndex}>
                          <td className="mission-target-select">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() =>
                                toggleBlueprintModel(slot.modelIndex)
                              }
                              aria-label={`选择 BP 模型槽位 ${slot.modelIndex}`}
                            />
                          </td>
                          <td>
                            <strong>{slot.modelIndex}</strong>
                          </td>
                          <td title={slot.modelClassPath}>
                            <code>
                              {slot.modelClassPath.split("/").at(-1)}
                            </code>
                          </td>
                          <td>
                            <code>{label.name}</code>
                          </td>
                          <td>
                            <span
                              className={`dialogue-model-status dialogue-model-status--${label.tone}`}
                            >
                              {label.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : plan ? (
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
                      <th>对话模型</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.targets.map((target) => {
                      const slot = blueprintInspection?.slots.find(
                        (item) => item.targetId === target.targetId,
                      );
                      const selected = selectedTargetIds.has(target.targetId);
                      const label = dialogueModelLabel(slot, selected);
                        return (
                          <tr key={target.targetId}>
                            <td className="mission-target-select">
                              <input
                                type="checkbox"
                                checked={selected}
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
                            <td>
                              <span
                                className={`dialogue-model-status dialogue-model-status--${label.tone}`}
                              >
                                {label.status}
                              </span>
                              <code title={label.name}>{label.name}</code>
                            </td>
                          </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="mission-target-empty">
              <Boxes size={28} />
              <strong>尚未解析任务节点</strong>
              <small>
                {blueprintInspection
                  ? "当前 BP 为空，请解析任务节点后选择目标物"
                  : `当前数据源包含 ${database.missionRows.length.toLocaleString()} 个任务节点`}
              </small>
            </div>
          )}
        </div>

        <footer>
          <span>
            {isDialogueRegistration
              ? `已选择 ${selectedModelCount} / ${blueprintModelSlots.length} 个 BP 模型，对话 ${blueprintInspection?.dialogueId ?? "未找到"}`
              : plan
              ? `已选择 ${selectedCount} / ${plan.targets.length} 个目标物，MapID ${plan.mapId}`
              : "检查 BP 不会修改对话或 UE 资产"}
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
              className="button"
              type="button"
              onClick={openTargetEditor}
              disabled={
                busy ||
                isDialogueRegistration ||
                !plan ||
                selectedCount === 0
              }
            >
              <PencilLine size={15} />
              修改位置
            </button>
            <button
              className="button"
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
            <button
              className="button button--primary"
              type="button"
              onClick={() =>
                void (isDialogueRegistration
                  ? registerDialogue()
                  : createBlueprint())
              }
              disabled={
                busy ||
                !blueprintName.trim() ||
                !blueprintInspection ||
                (isDialogueRegistration
                  ? blueprintModelSlots.length === 0
                  : !plan ||
                    blueprintInspection.blueprintState !== "empty" ||
                    selectedAssetTargets.length === 0)
              }
              title={
                isDialogueRegistration
                  ? "按 BP 数字槽位顺序写入对应对话的 DialogModels"
                  : "向空 PositionMode BP 写入所选资产并注册 DialogModels"
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : isDialogueRegistration ? (
                <Link2 size={16} />
              ) : (
                <PackagePlus size={16} />
              )}
              {busy
                ? "正在处理..."
                : isDialogueRegistration
                  ? "注册到对话"
                  : "创建 BP"}
            </button>
          </div>
        </footer>

        {mapLoadDecision && (
          <div
            className="mission-map-choice-layer"
            role="presentation"
          >
            <section
              className="mission-map-choice"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="mission-map-choice-title"
            >
              <header>
                <span>
                  <MapPinned size={18} />
                </span>
                <div>
                  <small>UE 当前关卡与任务地图不同</small>
                  <h3 id="mission-map-choice-title">
                    {mapLoadDecision.phase === "manual"
                      ? "等待手动切换地图"
                      : "选择地图加载方式"}
                  </h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title="取消"
                  aria-label="取消地图加载"
                  onClick={() => setMapLoadDecision(null)}
                  disabled={busy}
                >
                  <X size={17} />
                </button>
              </header>

              <div className="mission-map-choice__body">
                <dl>
                  <div>
                    <dt>UE 当前关卡</dt>
                    <dd title={mapLoadDecision.currentMapAssetPath}>
                      {mapLoadDecision.currentMapAssetPath}
                    </dd>
                  </div>
                  <div>
                    <dt>任务目标地图</dt>
                    <dd title={mapLoadDecision.plan.mapAssetPath}>
                      {mapLoadDecision.plan.mapName} ·{" "}
                      {mapLoadDecision.plan.mapAssetPath}
                    </dd>
                  </div>
                </dl>
                {mapLoadDecision.phase === "manual" && (
                  <p>
                    请在 UE 中完成地图切换，再检查并加载目标物。
                  </p>
                )}
                {mapLoadDecision.error && (
                  <div className="mission-map-choice__error" role="alert">
                    <AlertTriangle size={15} />
                    <span>{mapLoadDecision.error}</span>
                  </div>
                )}
              </div>

              <footer>
                {mapLoadDecision.phase === "choose" ? (
                  <>
                    <button
                      className="button"
                      type="button"
                      onClick={() =>
                        setMapLoadDecision((current) =>
                          current
                            ? { ...current, phase: "manual", error: "" }
                            : current,
                        )
                      }
                      disabled={busy}
                    >
                      <MonitorUp size={15} />
                      我来手动切换
                    </button>
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() =>
                        void executePreviewLoad(
                          mapLoadDecision.plan,
                          "auto",
                        )
                      }
                      disabled={busy}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <MapPinned size={15} />
                      )}
                      软件自动切换
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="button"
                      type="button"
                      onClick={() =>
                        setMapLoadDecision((current) =>
                          current
                            ? { ...current, phase: "choose", error: "" }
                            : current,
                        )
                      }
                      disabled={busy}
                    >
                      <ArrowLeft size={15} />
                      返回
                    </button>
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => void verifyManualMapAndLoad()}
                      disabled={busy}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <CheckCircle2 size={15} />
                      )}
                      检查并加载
                    </button>
                  </>
                )}
              </footer>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
