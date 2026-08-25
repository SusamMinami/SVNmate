import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
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
  BackgroundPropImportPreview,
  DialogueModelRegistrationSlot,
  DialogueDatabase,
  MissionTargetBlueprintInspection,
  MissionTargetEditRequest,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
  MissionTargetUpdateItem,
} from "../types";
import {
  applyBackgroundPropImport,
  clearMissionTargetPreview,
  checkMissionTargetBlueprint,
  createMissionTargetBlueprint,
  inspectMissionTargetMap,
  inspectMissionTargetBlueprint,
  inspectBackgroundPropImport,
  loadMissionTargetPreview,
  registerBlueprintDialogueModels,
  updateMissionTargetBlueprintPositions,
  updateMissionTargetsFromBlueprint,
} from "../ue/client";

interface MissionTargetModalProps {
  database: DialogueDatabase;
  onClose: () => void;
  embedded?: boolean;
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

function backgroundPropKindLabel(
  kind: BackgroundPropImportPreview["items"][number]["assetKind"],
): string {
  if (kind === "blueprint_actor") {
    return "Blueprint";
  }
  if (kind === "skeletal_mesh") {
    return "Skeletal Mesh";
  }
  if (kind === "static_mesh") {
    return "Static Mesh";
  }
  return "不支持";
}

function backgroundPropActionLabel(
  action: BackgroundPropImportPreview["items"][number]["action"],
): string {
  if (action === "create") {
    return "新增";
  }
  if (action === "update") {
    return "更新";
  }
  if (action === "unchanged") {
    return "无需修改";
  }
  return "已阻断";
}

export function MissionTargetModal({
  database,
  onClose,
  embedded = false,
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
  const [targetOverrides, setTargetOverrides] = useState<
    Map<string, MissionTargetUpdateItem["transform"]>
  >(new Map());
  const [backgroundPropPreview, setBackgroundPropPreview] =
    useState<BackgroundPropImportPreview | null>(null);
  const [selectedBackgroundActorRefs, setSelectedBackgroundActorRefs] =
    useState<Set<string>>(new Set());
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
  const blueprintSync = blueprintInspection?.sync;
  const isBlueprintSync =
    isDialogueRegistration && Boolean(blueprintSync);
  const blueprintChangeCount =
    blueprintSync?.mappings.filter(
      (mapping) =>
        mapping.positionDelta > 0.001 ||
        mapping.rotationDelta > 0.001,
    ).length ?? 0;
  const selectedSyncMappings =
    blueprintSync?.mappings.filter((mapping) =>
      selectedTargetIds.has(mapping.targetId),
    ) ?? [];
  const canUpdateBlueprint =
    isBlueprintSync && Boolean(blueprintSync?.canUpdateBlueprint);
  const canUpdateTargets =
    isBlueprintSync && Boolean(blueprintSync?.canUpdateTargets);
  const needsDialogueRegistration =
    isDialogueRegistration &&
    (!isBlueprintSync ||
      blueprintSync?.blockedReasons.some(
        (reason) =>
          reason.includes("Formation") ||
          reason.includes("DialogModels"),
      ));
  const syncBlocked =
    isBlueprintSync &&
    !canUpdateBlueprint &&
    !needsDialogueRegistration;
  const targetOverrideItems = Array.from(
    targetOverrides,
    ([targetId, transform]) => ({ targetId, transform }),
  );
  const selectableBackgroundItems =
    backgroundPropPreview?.items.filter(
      (item) => item.action !== "blocked",
    ) ?? [];
  const selectedBackgroundCount = selectableBackgroundItems.filter(
    (item) => selectedBackgroundActorRefs.has(item.actorRef),
  ).length;
  const allBackgroundItemsSelected =
    selectableBackgroundItems.length > 0 &&
    selectedBackgroundCount === selectableBackgroundItems.length;

  function applyBlueprintInspection(
    inspection: MissionTargetBlueprintInspection,
    updateStatus = true,
  ) {
    setBlueprintInspection(inspection);
    setSelectedModelIndexes(
      new Set(
        inspection.slots
          .filter((slot) => slot.modelIndex > 0)
          .map((slot) => slot.modelIndex),
      ),
    );
    if (inspection.refreshedPlan) {
      setPlan(inspection.refreshedPlan);
      const refreshedIds = new Set(
        inspection.refreshedPlan.targets.map(
          (target) => target.targetId,
        ),
      );
      setSelectedTargetIds((current) =>
        plan
          ? new Set(
              Array.from(current).filter((targetId) =>
                refreshedIds.has(targetId),
              ),
            )
          : refreshedIds,
      );
    }
    if (updateStatus) {
      setStatus(inspection.message);
    }
  }

  async function inspectTask(event: FormEvent) {
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
      if (blueprintName.trim()) {
        setBusy(true);
        const inspection = await inspectMissionTargetBlueprint(
          blueprintName.trim(),
          nextPlan,
          nextPlan.taskId,
          targetOverrideItems,
        );
        applyBlueprintInspection(inspection);
      }
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
    } finally {
      setBusy(false);
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

  async function inspectBackgroundProps() {
    if (!blueprintName.trim()) {
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const preview = await inspectBackgroundPropImport(
        blueprintName.trim(),
      );
      setBackgroundPropPreview(preview);
      setSelectedBackgroundActorRefs(
        new Set(
          preview.items
            .filter((item) => item.action !== "blocked")
            .map((item) => item.actorRef),
        ),
      );
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "读取 UE 背景资产失败",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleBackgroundProp(actorRef: string) {
    setSelectedBackgroundActorRefs((current) => {
      const next = new Set(current);
      if (next.has(actorRef)) {
        next.delete(actorRef);
      } else {
        next.add(actorRef);
      }
      return next;
    });
  }

  function toggleAllBackgroundProps() {
    setSelectedBackgroundActorRefs(
      allBackgroundItemsSelected
        ? new Set()
        : new Set(
            selectableBackgroundItems.map((item) => item.actorRef),
          ),
    );
  }

  async function importBackgroundProps() {
    if (
      !backgroundPropPreview ||
      !blueprintName.trim() ||
      selectedBackgroundCount === 0
    ) {
      return;
    }
    if (
      !window.confirm(
        `将向 ${backgroundPropPreview.blueprintAssetPath} 写入 ${selectedBackgroundCount} 个背景资产组件。` +
          "\n组件使用资产原名，并保留位置、旋转和缩放。" +
          "\n\nBP 将编译并保存，是否继续？",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await applyBackgroundPropImport(
        blueprintName.trim(),
        backgroundPropPreview.reviewToken,
        Array.from(selectedBackgroundActorRefs),
      );
      setBackgroundPropPreview(null);
      setSelectedBackgroundActorRefs(new Set());
      setStatus(
        result.status === "unchanged"
          ? "所选背景资产已经与 BP 一致"
          : `已写入背景资产：新增 ${result.createdComponentNames.length} 个，更新 ${result.updatedComponentNames.length} 个`,
      );
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "背景资产写入 BP 失败",
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
        plan?.taskId,
        targetOverrideItems,
      );
      applyBlueprintInspection(inspection);
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
      const spatialMessage =
        registration?.spatialStatus === "configured"
          ? "；已配置地图、虚拟场景和主角初始坐标"
          : registration?.spatialStatus === "unchanged"
            ? "；空间配置已完整"
            : "";
      setStatus(
        `已创建 ${result.blueprintAssetPath}：0 号玩家、${result.targetCount} 个目标物和 c1 摄像机；对话模型 ${
          registration?.registeredCount ?? 0
        } 个，None ${registration?.emptyCount ?? 0} 个${spatialMessage}`,
      );
      try {
        const inspection = await inspectMissionTargetBlueprint(
          blueprintName.trim(),
          plan,
          plan.taskId,
          targetOverrideItems,
        );
        applyBlueprintInspection(inspection, false);
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
        plan?.taskId,
        targetOverrideItems,
      );
      const unresolved = result.unresolvedIndexes.length
        ? `；槽位 ${result.unresolvedIndexes.join("、")} 未在 DialogNPCTable 登记，保持 None`
        : "";
      const spatialSource =
        result.spatialSource === "selected_actor"
          ? "UE 当前选择"
          : result.spatialSource === "level_scan"
            ? "当前地图扫描"
            : result.spatialSource === "task_targets"
              ? "任务目标物"
              : "";
      const spatialMessage =
        result.spatialStatus === "configured"
          ? `；已通过${spatialSource || "现有配置"}补齐地图和初始坐标`
          : result.spatialStatus === "unchanged"
            ? "；空间配置已完整"
            : result.spatialStatus === "not_configured"
              ? "；未找到关卡中的对应 BP，空间配置仍不完整"
            : "";
      setStatus(
        `${result.status === "unchanged" ? "对话模型无需变更" : `已注册到对话 ${result.dialogueId}`}：模型 ${result.registeredCount} 个，None ${result.emptyCount} 个${unresolved}${spatialMessage}`,
      );
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan ?? undefined,
        plan?.taskId,
        targetOverrideItems,
      );
      applyBlueprintInspection(inspection, false);
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

  async function updateBlueprintPositions() {
    if (
      !plan ||
      !blueprintName.trim() ||
      !blueprintSync?.canUpdateBlueprint
    ) {
      return;
    }
    const unmatched =
      blueprintSync.unmatchedTargetIds.length +
      blueprintSync.unmatchedModelIndexes.length;
    if (
      !window.confirm(
        `将从最新配置重新读取任务 ${plan.taskId}，把 ${selectedSyncMappings.length} 个目标物的位置和旋转写入 BP。` +
          `\n同时更新 Formation、Preview Level、虚拟场景和主角初始坐标。` +
          `${
            unmatched > 0
              ? `\n${unmatched} 个未映射项会保持不变。`
              : ""
          }\n\nBP 与对话资产将保存，是否继续？`,
      )
    ) {
      setStatus("已取消修改 BP 位置");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await updateMissionTargetBlueprintPositions(
        blueprintName.trim(),
        plan.taskId,
        selectedSyncMappings.map((mapping) => mapping.targetId),
        targetOverrideItems,
      );
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        plan.taskId,
        targetOverrideItems,
      );
      applyBlueprintInspection(inspection, false);
      setStatus(
        result.status === "unchanged"
          ? "BP 位置与对话空间配置已是最新"
          : `已更新 BP 槽位 ${result.updatedModelIndexes.join("、") || "无坐标变化"}；对话空间配置已同步`,
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "修改 BP 位置失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateTargetsFromBlueprint() {
    if (
      !plan ||
      !blueprintName.trim() ||
      !blueprintSync?.canUpdateTargets
    ) {
      return;
    }
    if (
      !window.confirm(
        `将把 BP 中 ${selectedSyncMappings.length} 个已映射模型的世界位置和旋转写入目标物表。` +
          `\n新增修改会标红，Excel 工作簿保持未保存状态。` +
          `${
            blueprintSync.unmatchedTargetIds.length ||
            blueprintSync.unmatchedModelIndexes.length
              ? "\n未映射项不会修改。"
              : ""
          }\n\n是否继续？`,
      )
    ) {
      setStatus("已取消从 BP 更新目标物");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await updateMissionTargetsFromBlueprint(
        blueprintName.trim(),
        plan.taskId,
        selectedSyncMappings.map((mapping) => mapping.targetId),
        targetOverrideItems,
      );
      applyTargetUpdates(result.items);
      const updates = new Map(
        result.items.map((item) => [item.targetId, item.transform]),
      );
      setBlueprintInspection((current) =>
        current?.sync
          ? {
              ...current,
              refreshedPlan: current.refreshedPlan
                ? {
                    ...current.refreshedPlan,
                    targets: current.refreshedPlan.targets.map((target) => {
                      const transform = updates.get(target.targetId);
                      return transform
                        ? {
                            ...target,
                            transform: {
                              ...target.transform,
                              ...transform,
                            },
                          }
                        : target;
                    }),
                  }
                : current.refreshedPlan,
              sync: {
                ...current.sync,
                mappings: current.sync.mappings.map((mapping) => {
                  const transform = updates.get(mapping.targetId);
                  return transform
                    ? {
                        ...mapping,
                        currentTargetTransform: transform,
                        positionDelta: 0,
                        rotationDelta: 0,
                      }
                    : mapping;
                }),
              },
            }
          : current,
      );
      setStatus(
        result.updatedTargets.length > 0
          ? `已将 BP 位置写入 ${result.updatedTargets.length} 个目标物（Excel 未保存）`
          : "BP 与目标物位置已经一致",
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "从 BP 更新目标物失败",
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
    setTargetOverrides((current) => {
      const next = new Map(current);
      for (const [targetId, transform] of updates) {
        next.set(targetId, transform);
      }
      return next;
    });
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
        embedded={embedded}
        editRequest={editRequest}
        onTargetsUpdated={applyTargetUpdates}
        onClose={() => setEditRequest(null)}
      />
    );
  }

  const returnButton = (
    <button
      className={embedded ? "icon-button workspace-floating-back" : "icon-button"}
      type="button"
      title={embedded ? "返回分镜工作台" : "关闭"}
      aria-label={embedded ? "返回分镜工作台" : "关闭任务目标物"}
      onClick={onClose}
      disabled={busy}
    >
      {embedded ? <ArrowLeft size={17} /> : <X size={17} />}
    </button>
  );

  return (
    <div
      className={`modal-backdrop mission-target-backdrop ${
        embedded ? "tool-workspace__embedded" : ""
      }`}
      role={embedded ? undefined : "presentation"}
    >
      <section
        className="mission-target-modal"
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-label={embedded ? "任务目标物" : undefined}
        aria-labelledby={embedded ? undefined : "mission-target-title"}
      >
        {embedded ? (
          <div className="workspace-floating-actions">
            {returnButton}
          </div>
        ) : (
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
            {returnButton}
          </header>
        )}

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
                setTargetOverrides(new Map());
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
          {isDialogueRegistration &&
          !isBlueprintSync &&
          blueprintInspection ? (
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
              {blueprintSync &&
                (blueprintSync.blockedReasons.length > 0 ||
                  blueprintSync.unmatchedTargetIds.length > 0 ||
                  blueprintSync.unmatchedModelIndexes.length > 0) && (
                  <section className="mission-target-warnings">
                    {blueprintSync.blockedReasons.map((warning) => (
                      <p key={warning}>
                        <AlertTriangle size={14} />
                        <span>{warning}</span>
                      </p>
                    ))}
                    {blueprintSync.unmatchedTargetIds.length > 0 && (
                      <p>
                        <AlertTriangle size={14} />
                        <span>
                          未找到 BP 对应模型的目标物：
                          {blueprintSync.unmatchedTargetIds.join("、")}
                        </span>
                      </p>
                    )}
                    {blueprintSync.unmatchedModelIndexes.length > 0 && (
                      <p>
                        <AlertTriangle size={14} />
                        <span>
                          保持不变的 BP 额外槽位：
                          {blueprintSync.unmatchedModelIndexes.join("、")}
                        </span>
                      </p>
                    )}
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
                              <code title={label.name}>
                                {slot
                                  ? `BP ${slot.modelIndex} · ${label.name}`
                                  : label.name}
                              </code>
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
            {isBlueprintSync
              ? `已选择 ${selectedSyncMappings.length} / ${blueprintSync?.mappings.length ?? 0} 个已映射目标物，${blueprintChangeCount} 项位置不同`
              : isDialogueRegistration
              ? `已选择 ${selectedModelCount} / ${blueprintModelSlots.length} 个 BP 模型，对话 ${blueprintInspection?.dialogueId ?? "未找到"}`
              : plan
              ? `已选择 ${selectedCount} / ${plan.targets.length} 个目标物，MapID ${plan.mapId}`
              : "检查 BP 不会修改对话或 UE 资产"}
          </span>
          <div>
            <button
              className="button"
              type="button"
              onClick={() => void inspectBackgroundProps()}
              disabled={
                busy ||
                !blueprintName.trim() ||
                blueprintInspection?.blueprintState !== "populated"
              }
              title="读取 UE 当前选择并写入非数字背景组件"
            >
              <Boxes size={15} />
              背景资产
            </button>
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
              className={`button ${
                isBlueprintSync ? "button--primary" : ""
              }`}
              type="button"
              onClick={() =>
                void (isBlueprintSync
                  ? updateTargetsFromBlueprint()
                  : openTargetEditor())
              }
              disabled={
                busy ||
                (isBlueprintSync
                  ? !canUpdateTargets ||
                    selectedSyncMappings.length === 0
                  : isDialogueRegistration ||
                    !plan ||
                    selectedCount === 0)
              }
              title={
                isBlueprintSync
                  ? blueprintSync?.hasExplicitRoot
                    ? "把 BP 模型的世界位置和旋转写入目标物表"
                    : "需要先建立 BP 世界坐标"
                  : "编辑所选目标物的位置和旋转"
              }
            >
              {isBlueprintSync ? (
                <ArrowRightLeft size={15} />
              ) : (
                <PencilLine size={15} />
              )}
              {isBlueprintSync ? "BP → 目标物" : "修改位置"}
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
                void (canUpdateBlueprint
                  ? updateBlueprintPositions()
                  : needsDialogueRegistration
                    ? registerDialogue()
                    : createBlueprint())
              }
              disabled={
                busy ||
                !blueprintName.trim() ||
                !blueprintInspection ||
                (canUpdateBlueprint
                  ? !plan || selectedSyncMappings.length === 0
                  : needsDialogueRegistration
                  ? blueprintModelSlots.length === 0
                  : syncBlocked ||
                    !plan ||
                    blueprintInspection.blueprintState !== "empty" ||
                    selectedAssetTargets.length === 0)
              }
              title={
                canUpdateBlueprint
                  ? "从最新目标物配置更新 BP 模型位置和对话空间配置"
                  : needsDialogueRegistration
                  ? "按 BP 数字槽位顺序写入对应对话的 DialogModels"
                  : syncBlocked
                    ? blueprintSync?.blockedReasons.join("；")
                  : "向空 PositionMode BP 写入所选资产并注册 DialogModels"
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : canUpdateBlueprint || needsDialogueRegistration ? (
                <Link2 size={16} />
              ) : (
                <PackagePlus size={16} />
              )}
              {busy
                ? "正在处理..."
                : canUpdateBlueprint
                  ? "修改 BP 位置"
                  : needsDialogueRegistration
                  ? "注册到对话"
                  : syncBlocked
                    ? "无法修改 BP"
                  : "创建 BP"}
            </button>
          </div>
        </footer>

        {backgroundPropPreview && (
          <div className="mission-map-choice-layer" role="presentation">
            <section
              className="mission-map-choice background-prop-choice"
              role="dialog"
              aria-modal="true"
              aria-labelledby="background-prop-title"
            >
              <header>
                <span>
                  <Boxes size={18} />
                </span>
                <div>
                  <small>UE 当前选择写入 Blueprint</small>
                  <h3 id="background-prop-title">导入背景资产</h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭背景资产导入"
                  onClick={() => {
                    setBackgroundPropPreview(null);
                    setSelectedBackgroundActorRefs(new Set());
                  }}
                  disabled={busy}
                >
                  <X size={17} />
                </button>
              </header>
              <div className="background-prop-choice__summary">
                <code title={backgroundPropPreview.blueprintAssetPath}>
                  {backgroundPropPreview.blueprintAssetPath}
                </code>
                <span>
                  当前地图：{backgroundPropPreview.mapAssetPath}
                </span>
              </div>
              {backgroundPropPreview.blockedReasons.length > 0 && (
                <div
                  className="mission-map-choice__error"
                  role="alert"
                >
                  <AlertTriangle size={15} />
                  <span>
                    {backgroundPropPreview.blockedReasons.join("；")}
                  </span>
                </div>
              )}
              <div className="background-prop-table-wrap">
                <table className="mission-target-table background-prop-table">
                  <thead>
                    <tr>
                      <th className="mission-target-select">
                        <input
                          type="checkbox"
                          checked={allBackgroundItemsSelected}
                          ref={(element) => {
                            if (element) {
                              element.indeterminate =
                                selectedBackgroundCount > 0 &&
                                !allBackgroundItemsSelected;
                            }
                          }}
                          onChange={toggleAllBackgroundProps}
                          aria-label="选择全部背景资产"
                        />
                      </th>
                      <th>Actor</th>
                      <th>资产类型</th>
                      <th>组件名</th>
                      <th>世界位置</th>
                      <th>缩放</th>
                      <th>处理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backgroundPropPreview.items.map((item) => {
                      const blocked = item.action === "blocked";
                      return (
                        <tr key={item.actorRef}>
                          <td className="mission-target-select">
                            <input
                              type="checkbox"
                              checked={selectedBackgroundActorRefs.has(
                                item.actorRef,
                              )}
                              disabled={blocked}
                              onChange={() =>
                                toggleBackgroundProp(item.actorRef)
                              }
                              aria-label={`选择背景资产 ${item.actorLabel}`}
                            />
                          </td>
                          <td title={item.actorRef}>
                            <strong>{item.actorLabel}</strong>
                            <small title={item.assetPath}>
                              {item.assetPath || item.message}
                            </small>
                          </td>
                          <td>
                            {backgroundPropKindLabel(item.assetKind)}
                          </td>
                          <td>
                            <code>{item.componentName || "-"}</code>
                          </td>
                          <td>
                            <code>
                              {[
                                item.worldTransform.location.x,
                                item.worldTransform.location.y,
                                item.worldTransform.location.z,
                              ]
                                .map((value) => value.toFixed(1))
                                .join(", ")}
                            </code>
                          </td>
                          <td>
                            <code>
                              {[
                                item.worldTransform.scale.x,
                                item.worldTransform.scale.y,
                                item.worldTransform.scale.z,
                              ]
                                .map((value) => value.toFixed(2))
                                .join(", ")}
                            </code>
                          </td>
                          <td title={item.message}>
                            <span
                              className={`dialogue-model-status dialogue-model-status--${
                                blocked
                                  ? "warning"
                                  : item.action === "unchanged"
                                    ? "registered"
                                    : "pending"
                              }`}
                            >
                              {backgroundPropActionLabel(item.action)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <footer>
                <span>
                  已选择 {selectedBackgroundCount} /{" "}
                  {selectableBackgroundItems.length} 个可导入资产
                </span>
                <div>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setBackgroundPropPreview(null);
                      setSelectedBackgroundActorRefs(new Set());
                    }}
                    disabled={busy}
                  >
                    取消
                  </button>
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => void importBackgroundProps()}
                    disabled={
                      busy ||
                      selectedBackgroundCount === 0 ||
                      backgroundPropPreview.blockedReasons.length > 0
                    }
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <PackagePlus size={15} />
                    )}
                    {busy ? "正在写入..." : "写入 BP"}
                  </button>
                </div>
              </footer>
            </section>
          </div>
        )}

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
