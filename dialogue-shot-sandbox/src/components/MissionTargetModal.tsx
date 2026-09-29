import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Database,
  FileSearch,
  Link2,
  MapPinned,
  MonitorUp,
  PackagePlus,
  PencilLine,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { useOperationFeedback } from "../app/useOperationFeedback";
import { OverlayScrollArea } from "./OverlayScrollArea";
import { OperationIcon, TaskNotice } from "./TaskMotion";
import { DialogNpcRegistrationModal } from "./DialogNpcRegistrationModal";
import { MissionTargetDialoguePreview } from "./MissionTargetDialoguePreview";
import { MissionTargetRow } from "./MissionTargetRow";
import { NpcRegistrationModal } from "./NpcRegistrationModal";
import { findDialogueTimeline } from "../data/dialogueRepository";
import {
  resolveMissionTargets,
  sortMissionTargetsByDialogueFrequency,
} from "../data/missionTargetResolver";
import {
  classifyMissionTargetSelection,
  type MissionTargetSelectionClassification,
} from "../data/missionTargetSelection";
import type {
  BackgroundPropImportPreview,
  DialogNpcTableRegistrationDraft,
  DialogNpcTableRegistrationReview,
  DialogueModelRegistrationSlot,
  DialogueDatabase,
  MissionTargetBlueprintInspection,
  MissionTargetEditRequest,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
  MissionTargetUpdateItem,
  SelectedLevelActorsResult,
} from "../types";
import {
  appendMissionTargetBlueprint,
  applyDialogNpcTableRegistration,
  applyBackgroundPropImport,
  clearMissionTargetPreview,
  checkMissionTargetBlueprint,
  createMissionTargetBlueprint,
  inspectMissionTargetMap,
  inspectMissionTargetBlueprint,
  inspectBackgroundPropImport,
  inspectDialogNpcTableRegistration,
  loadMissionTargetPreview,
  readSelectedLevelActors,
  refreshMissionTargetPlan,
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
  phase: "choose" | "manual" | "auto" | "verify";
  error: string;
}

function isMapLoadStillInProgress(message: string): boolean {
  return /(?:正在加载|暂时无法读取关卡状态|尚未完成.*地图切换|加载期间通信暂时不可用|['"]?this['"]?\s+pointer is invalid)/i.test(
    message,
  );
}

function mapLoadProgressMessage(mapName: string): string {
  return `UE 已发起 ${mapName} 的地图切换。大型关卡加载期间可能暂时无法响应；加载完成后选择“检查并加载”。`;
}

interface UeTargetSelectionReview {
  taskId: string;
  selection: SelectedLevelActorsResult;
  classification: MissionTargetSelectionClassification;
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
  currentMap = false,
): string {
  const mapStatus = currentMap
    ? "已加载到当前 UE 关卡"
    : result.autoOpenedMap
      ? `已自动打开 ${plan.mapName}`
      : `当前已是 ${plan.mapName}`;
  return `${mapStatus}，加载 ${result.assetCount} 个资产和 ${result.markerCount} 个定位标记${
    plan.dialogueTimeline
      ? `，已选中 ${result.selectedActorCount ?? 0} 个变更角色供 NPC 注册`
      : ""
  }`;
}

function dialogueModelLabel(
  slot: DialogueModelRegistrationSlot | undefined,
  selected: boolean,
  omitUnselected = false,
): { name: string; status: string; tone: string } {
  if (!selected) {
    if (omitUnselected) {
      return { name: "-", status: "不导入", tone: "empty" };
    }
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
  if (kind === "particle_system") {
    return "Cascade 特效";
  }
  if (kind === "niagara_system") {
    return "Niagara 特效";
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
  const [dialogueId, setDialogueId] = useState("");
  const [dialogueIdExpanded, setDialogueIdExpanded] = useState(false);
  const [plan, setPlan] = useState<MissionTargetPreviewPlan | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(
    new Set(),
  );
  const [blueprintInspection, setBlueprintInspection] =
    useState<MissionTargetBlueprintInspection | null>(null);
  const [editRequest, setEditRequest] =
    useState<MissionTargetEditRequest | null>(null);
  const [targetOverrides, setTargetOverrides] = useState<
    Map<string, MissionTargetUpdateItem["transform"]>
  >(new Map());
  const [backgroundPropPreview, setBackgroundPropPreview] =
    useState<BackgroundPropImportPreview | null>(null);
  const [selectedBackgroundActorRefs, setSelectedBackgroundActorRefs] =
    useState<Set<string>>(new Set());
  const [backgroundMatchedTargetIds, setBackgroundMatchedTargetIds] = useState<
    string[]
  >([]);
  const [ueTargetSelectionReview, setUeTargetSelectionReview] =
    useState<UeTargetSelectionReview | null>(null);
  const [existingSlotsExpanded, setExistingSlotsExpanded] = useState(false);
  const [backgroundPropError, setBackgroundPropError] = useState("");
  const [dialogNpcReview, setDialogNpcReview] =
    useState<DialogNpcTableRegistrationReview | null>(null);
  const [dialogNpcRegistrationBusy, setDialogNpcRegistrationBusy] =
    useState(false);
  const [dialogNpcRegistrationError, setDialogNpcRegistrationError] =
    useState("");
  const [mapLoadDecision, setMapLoadDecision] =
    useState<MapLoadDecision | null>(null);
  const { busy, setBusy, setError, setStatus, beginTask, setTaskLabel, feedback, activeOperation } = useOperationFeedback();
  const lastTaskSearchIdRef = useRef("");
  const selectedCount = useMemo(() =>
    plan?.targets.filter((target) => selectedTargetIds.has(target.targetId))
      .length ?? 0, [plan, selectedTargetIds]);
  const blueprintDialoguePreviewPlan =
    blueprintInspection?.dialoguePreviewPlan ?? null;
  const hasDialoguePositionPreview =
    !plan && Boolean(blueprintDialoguePreviewPlan?.dialogueTimeline);
  const dialogueInput = dialogueId.trim();
  const dialoguePreviewNodeId = /^\d{6}$/.test(dialogueInput)
    ? dialogueInput
    : undefined;
  const dialogueNodeInputValid =
    !dialogueInput || Boolean(dialoguePreviewNodeId);
  const blueprintInputIsDialogueNode = /^\d{6}$/.test(
    blueprintName.trim(),
  );
  const dialoguePreviewRequest = useMemo(
    () => {
      if (!dialoguePreviewNodeId) {
        return null;
      }
      const fullTimeline = findDialogueTimeline(
        database,
        dialoguePreviewNodeId,
      );
      const targetIndex = fullTimeline.findIndex(
        (row) => row.id === dialoguePreviewNodeId,
      );
      return {
        dialogueAssetId:
          fullTimeline[0]?.id ??
          `${dialoguePreviewNodeId.slice(0, 4)}00`,
        timeline:
          targetIndex >= 0
            ? fullTimeline.slice(0, targetIndex + 1).map((row) => ({
                id: row.id,
                characterBehaviourString: row.characterBehaviourString,
                relativeTransformsString: row.relativeTransformsString,
              }))
            : [],
      };
    },
    [database, dialoguePreviewNodeId],
  );
  const configuredDialogueId =
    dialoguePreviewRequest?.dialogueAssetId;
  const configuredDialogueTimeline =
    dialoguePreviewRequest?.timeline;
  const isDialogueRegistration =
    blueprintInspection?.blueprintState === "populated";
  const {
    existingTargetIds, targetRows, selectableTargetRows, selectedTargetRowCount,
    allSelected, selectedAssetTargets, blueprintCreationTargets, selectedAppendTargets,
    blueprintRegistrationSlots, blueprintModelSlots, maximumBlueprintModelIndex,
    blueprintSync, isBlueprintSync, selectedSyncMappings, canUpdateBlueprint,
    canUpdateTargets, targetOverrideItems, selectableBackgroundItems,
    selectedBackgroundCount, selectedDialogueNpcCount, allBackgroundItemsSelected,
    backgroundDialogueSetupReasons, backgroundAutoConfigurationRequired,
    backgroundBlockingReasons, activeUeTargetSelectionReview, ueSelectedTargetIds,
    dialogNpcRegistrationSlots, targetsById, matchesByActorRef,
    appendSlotsByTargetId, slotsByTargetId, creationIndexByTargetId, appendIndexByTargetId,
  } = useMemo(() => {
  const existingTargetIds = new Set(
    blueprintInspection?.sync?.mappings.map((mapping) => mapping.targetId) ??
      [],
  );
  const targetRows =
    plan?.targets.filter(
      (target) =>
        !(
          blueprintInspection?.blueprintState === "populated" &&
          existingTargetIds.has(target.targetId)
        ),
    ) ?? [];
  const selectableTargetRows = isDialogueRegistration
    ? targetRows.filter(
        (target) =>
          target.previewKind === "asset" && Boolean(target.modelClassPath),
      )
    : targetRows;
  const selectedTargetRowCount = selectableTargetRows.filter((target) =>
    selectedTargetIds.has(target.targetId),
  ).length;
  const allSelected =
    selectableTargetRows.length > 0 &&
    selectedTargetRowCount === selectableTargetRows.length;
  const selectedAssetTargets =
    plan?.targets.filter(
      (target) =>
        selectedTargetIds.has(target.targetId) &&
        target.previewKind === "asset" &&
        Boolean(target.modelClassPath),
    ) ?? [];
  const blueprintCreationTargets =
    blueprintInspection?.blueprintState === "empty"
      ? sortMissionTargetsByDialogueFrequency(
          database,
          blueprintInspection.dialogueId,
          selectedAssetTargets,
        )
      : selectedAssetTargets;
  const selectedAppendTargets =
    blueprintInspection?.blueprintState === "populated"
      ? selectedAssetTargets.filter(
          (target) => !existingTargetIds.has(target.targetId),
        )
      : [];
  const blueprintRegistrationSlots = blueprintInspection?.slots ?? [];
  const blueprintModelSlots = blueprintRegistrationSlots.filter(
    (slot) => slot.modelIndex > 0,
  );
  const maximumBlueprintModelIndex = Math.max(
    0,
    ...blueprintRegistrationSlots.map((slot) => slot.modelIndex),
  );
  const blueprintSync = blueprintInspection?.sync;
  const isBlueprintSync =
    isDialogueRegistration && Boolean(blueprintSync);
  const selectedSyncMappings =
    blueprintSync?.mappings.filter((mapping) =>
      selectedTargetIds.has(mapping.targetId),
    ) ?? [];
  const canUpdateBlueprint =
    isBlueprintSync && Boolean(blueprintSync?.canUpdateBlueprint);
  const canUpdateTargets =
    isBlueprintSync && Boolean(blueprintSync?.canUpdateTargets);
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
  const selectedDialogueNpcCount = selectableBackgroundItems.filter(
    (item) =>
      item.importMode === "dialogue_npc" &&
      selectedBackgroundActorRefs.has(item.actorRef),
  ).length;
  const allBackgroundItemsSelected =
    selectableBackgroundItems.length > 0 &&
    selectedBackgroundCount === selectableBackgroundItems.length;
  const backgroundDialogueSetupReasons =
    backgroundPropPreview?.blockedReasons.filter(
      (reason) =>
        reason.startsWith("对话 Formation") ||
        reason.startsWith("对话尚未配置") ||
        reason.startsWith("对话尚未启用虚拟场景"),
    ) ?? [];
  const backgroundAutoConfigurationRequired =
    selectedDialogueNpcCount > 0 &&
    backgroundDialogueSetupReasons.length > 0;
  const backgroundBlockingReasons =
    backgroundPropPreview?.blockedReasons.filter(
      (reason) =>
        !backgroundAutoConfigurationRequired ||
        !backgroundDialogueSetupReasons.includes(reason),
    ) ?? [];
  const activeUeTargetSelectionReview =
    plan && ueTargetSelectionReview?.taskId === plan.taskId
      ? ueTargetSelectionReview
      : null;
  const ueSelectedTargetIds = new Set(
    activeUeTargetSelectionReview?.classification.matches.map(
      (match) => match.targetId,
    ) ?? [],
  );
  const selectedAppendTargetIds = new Set(
    selectedAppendTargets.map((target) => target.targetId),
  );
  const dialogNpcRegistrationSlots = (
    blueprintInspection?.blueprintState === "populated"
      ? [
          ...blueprintModelSlots,
          ...(blueprintInspection.appendSlots?.filter(
            (slot) =>
              slot.targetId !== null &&
              selectedAppendTargetIds.has(slot.targetId),
          ) ?? []),
        ]
      : blueprintRegistrationSlots.filter(
          (slot) =>
            slot.modelIndex > 0 &&
            (slot.targetId === null || selectedTargetIds.has(slot.targetId)),
        )
  ).filter((slot) => slot.status === "unmapped");
  // Keep Array.find's first-match semantics even for incomplete inspection data.
  function indexFirst<T, K>(items: readonly T[], key: (item: T) => K) {
    const result = new Map<K, T>();
    for (const item of items) {
      const id = key(item);
      if (!result.has(id)) result.set(id, item);
    }
    return result;
  }
  return {
    existingTargetIds, targetRows, selectableTargetRows, selectedTargetRowCount,
    allSelected, selectedAssetTargets, blueprintCreationTargets, selectedAppendTargets,
    blueprintRegistrationSlots, blueprintModelSlots, maximumBlueprintModelIndex,
    blueprintSync, isBlueprintSync, selectedSyncMappings, canUpdateBlueprint,
    canUpdateTargets, targetOverrideItems, selectableBackgroundItems,
    selectedBackgroundCount, selectedDialogueNpcCount, allBackgroundItemsSelected,
    backgroundDialogueSetupReasons, backgroundAutoConfigurationRequired,
    backgroundBlockingReasons, activeUeTargetSelectionReview, ueSelectedTargetIds,
    dialogNpcRegistrationSlots,
    targetsById: indexFirst(plan?.targets ?? [], (target) => target.targetId),
    matchesByActorRef: indexFirst(activeUeTargetSelectionReview?.classification.matches ?? [], (match) => match.actorRef),
    appendSlotsByTargetId: indexFirst(blueprintInspection?.appendSlots ?? [], (slot) => slot.targetId),
    slotsByTargetId: indexFirst(blueprintRegistrationSlots, (slot) => slot.targetId),
    creationIndexByTargetId: new Map(blueprintCreationTargets.map((target, index) => [target.targetId, index])),
    appendIndexByTargetId: new Map(selectedAppendTargets.map((target, index) => [target.targetId, index])),
  };
  }, [plan, blueprintInspection, selectedTargetIds, database, isDialogueRegistration,
    targetOverrides, backgroundPropPreview, selectedBackgroundActorRefs, ueTargetSelectionReview]);

  function applyBlueprintInspection(
    inspection: MissionTargetBlueprintInspection,
    updateStatus = true,
    preserveSelection = false,
  ) {
    setBlueprintInspection(inspection);
    if (inspection.refreshedPlan) {
      setPlan(inspection.refreshedPlan);
      const refreshedIds = new Set(
        inspection.refreshedPlan.targets.map(
          (target) => target.targetId,
        ),
      );
      if (!preserveSelection) {
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
    }
    if (inspection.blueprintState === "populated") {
      if (!preserveSelection) {
        setSelectedTargetIds(
          new Set(
            inspection.sync?.mappings.map((mapping) => mapping.targetId) ?? [],
          ),
        );
      }
      setExistingSlotsExpanded(
        inspection.slots.some(
          (slot) =>
            slot.status !== "registered" ||
            slot.registrationMatchesModel === false,
        ),
      );
    } else {
      setExistingSlotsExpanded(false);
    }
    if (updateStatus) {
      setStatus(inspection.message);
    }
  }

  async function openDialogNpcRegistration(
    slots = dialogNpcRegistrationSlots,
  ): Promise<void> {
    if (slots.length === 0) {
      return;
    }
    beginTask("正在读取 Character BP 与补登记审核");
    setError("");
    setStatus("");
    setDialogNpcRegistrationError("");
    try {
      const review = await inspectDialogNpcTableRegistration(
        slots.map((slot) => ({
          modelIndex: slot.modelIndex,
          targetId: slot.targetId,
          modelClassPath: slot.modelClassPath,
        })),
      );
      if (review.rows.length === 0) {
        setStatus("相关 Character BP 已完成 DialogNPCTable 登记，请重新检查");
        return;
      }
      setDialogNpcReview(review);
      setStatus("补登记审核已就绪，请核对 Camera BP");
    } catch (registrationError) {
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "DialogNPCTable 登记预检失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveDialogNpcRegistration(
    rows: Array<
      Pick<
        DialogNpcTableRegistrationDraft,
        | "rowName"
        | "characterClassPath"
        | "animClassPath"
        | "cameraClassPath"
        | "meshPath"
      >
    >,
  ): Promise<void> {
    if (!dialogNpcReview || !blueprintName.trim()) {
      return;
    }
    setDialogNpcRegistrationBusy(true);
    beginTask("正在登记并保存 DialogNPCTable");
    setDialogNpcRegistrationError("");
    let saved = false;
    try {
      const result = await applyDialogNpcTableRegistration(
        dialogNpcReview.reviewToken,
        rows,
      );
      saved = true;
      setTaskLabel("DialogNPCTable 已保存，正在刷新 BP 检查");
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan ?? undefined,
        plan?.taskId,
        targetOverrideItems,
        configuredDialogueId,
        configuredDialogueTimeline,
      );
      applyBlueprintInspection(inspection, false, true);
      setDialogNpcReview(null);
      setStatus(
        `已登记并保存 DialogNPCTable：${result.registeredRowNames.join("、")}；请继续原 BP 注册操作`,
        "success",
      );
    } catch (registrationError) {
      const message = registrationError instanceof Error ? registrationError.message : "DialogNPCTable 登记失败";
      if (saved) {
        setDialogNpcReview(null);
        setStatus(`DialogNPCTable 已保存，BP 检查刷新失败：${message}。请重新检查 BP。`, "warning");
      } else {
        setDialogNpcRegistrationError(`${message}；请核对 UE 资产状态后重新检查，勿立即重复写入。`);
      }
    } finally {
      setDialogNpcRegistrationBusy(false);
      setBusy(false);
    }
  }

  async function inspectTask(event: FormEvent) {
    event.preventDefault();
    const normalizedTaskId = taskId.trim();
    const shouldRefresh =
      lastTaskSearchIdRef.current === normalizedTaskId;
    lastTaskSearchIdRef.current = normalizedTaskId;
    setError("");
    setStatus("");
    setUeTargetSelectionReview(null);
    beginTask(shouldRefresh ? "正在刷新配置并解析任务目标物" : "正在解析任务与 BP 配置", "search");
    try {
      const nextPlan = shouldRefresh
        ? await refreshMissionTargetPlan(normalizedTaskId)
        : resolveMissionTargets(database, normalizedTaskId);
      setPlan(nextPlan);
      setSelectedTargetIds(
        new Set(nextPlan.targets.map((target) => target.targetId)),
      );
      setBlueprintInspection(null);
      if (blueprintName.trim()) {
        const inspection = await inspectMissionTargetBlueprint(
          blueprintName.trim(),
          nextPlan,
          shouldRefresh ? nextPlan.taskId : undefined,
          targetOverrideItems,
          configuredDialogueId,
          configuredDialogueTimeline,
        );
        applyBlueprintInspection(inspection);
      } else {
        setStatus(
          shouldRefresh
            ? "已刷新配置并解析任务目标物"
            : "已从缓存解析任务目标物；再次搜索可刷新配置",
        );
      }
    } catch (resolutionError) {
      setPlan(null);
      setSelectedTargetIds(new Set());
      setBlueprintInspection(null);
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
    beginTask(mapMode === "auto" ? "正在等待 UE 切图并加载预览" : "正在检查当前关卡并加载预览");
    setError("");
    setStatus("");
    setBackgroundPropError("");
    if (mapMode === "auto") {
      setMapLoadDecision((current) =>
        current ? { ...current, phase: "auto", error: "" } : current,
      );
    }
    try {
      const result = await loadMissionTargetPreview(selectedPlan, mapMode);
      setMapLoadDecision(null);
      setStatus(loadSummary(selectedPlan, result), "success");
    } catch (previewError) {
      const message =
        previewError instanceof Error
          ? previewError.message
          : "目标物预览加载失败";
      if (mapLoadDecision) {
        const canContinueAfterMapLoad =
          mapMode === "auto" && isMapLoadStillInProgress(message);
        setMapLoadDecision((current) =>
          current
            ? {
                ...current,
                phase: canContinueAfterMapLoad
                  ? "verify"
                  : mapMode === "auto"
                    ? "choose"
                    : current.phase,
                error: canContinueAfterMapLoad
                  ? mapLoadProgressMessage(selectedPlan.mapName)
                  : message,
              }
            : current,
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function fillBackgroundDialogueConfiguration(
    reviewedActorRefs: string[],
  ) {
    const matchedTargetIds = backgroundMatchedTargetIds;
    const result = await registerBlueprintDialogueModels(
      blueprintName.trim(),
      [],
      plan?.taskId,
      targetOverrideItems,
      true,
      configuredDialogueId,
    );
    const inspection = await inspectMissionTargetBlueprint(
      blueprintName.trim(),
      plan ?? undefined,
      plan?.taskId,
      targetOverrideItems,
      configuredDialogueId,
      configuredDialogueTimeline,
    );
    applyBlueprintInspection(inspection, false);
    if (matchedTargetIds.length > 0) {
      const refreshedExistingTargetIds =
        inspection.sync?.mappings.map((mapping) => mapping.targetId) ?? [];
      setSelectedTargetIds(
        new Set([...refreshedExistingTargetIds, ...matchedTargetIds]),
      );
    }
    const preview = await inspectBackgroundPropImport(
      blueprintName.trim(),
      reviewedActorRefs.length > 0 ? reviewedActorRefs : undefined,
      configuredDialogueId,
      taskId.trim() || undefined,
    );
    setBackgroundPropPreview(preview);
    setSelectedBackgroundActorRefs((current) =>
      new Set(
        preview.items
          .filter(
            (item) =>
              item.action !== "blocked" &&
              current.has(item.actorRef),
          )
          .map((item) => item.actorRef),
      ),
    );
    return { result, preview };
  }

  async function configureBackgroundDialogue() {
    if (!blueprintName.trim() || !backgroundPropPreview) {
      return;
    }
    if (
      !window.confirm(
        "将补齐当前 BP 对应对话的 Formation、Preview Level、虚拟场景和主角初始 Transform。" +
          "\n现有 DialogModels 保持不变。" +
          "\n\n对话资产将保存，是否继续？",
      )
    ) {
      setStatus("已取消补齐对话配置", "cancelled");
      return;
    }
    beginTask("正在补齐对话空间配置");
    setBackgroundPropError("");
    setError("");
    setStatus("");
    try {
      const { result } = await fillBackgroundDialogueConfiguration(
        backgroundPropPreview.items.map((item) => item.actorRef),
      );
      if (result.spatialStatus === "not_configured") {
        setBackgroundPropError(
          "Formation 已补齐，但无法确定 BP 的世界位置。请把该 BP 放入当前地图，或输入任务节点后重试。",
        );
      } else {
        setStatus("已补齐对话空间配置，并重新读取 UE 当前选择", "success");
      }
    } catch (configurationError) {
      setBackgroundPropError(
        configurationError instanceof Error
          ? configurationError.message
          : "补齐对话空间配置失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview() {
    if (
      plan
        ? selectedCount === 0
        : !blueprintName.trim() || !dialoguePreviewNodeId
    ) {
      return;
    }
    beginTask(plan ? "正在检查目标地图" : blueprintDialoguePreviewPlan ? "正在加载节点站位到 UE" : "正在读取 BP 并计算节点站位");
    setError("");
    setStatus("");
    try {
      let selectedPlan: MissionTargetPreviewPlan;
      if (plan) {
        selectedPlan = {
          ...plan,
          targets: plan.targets.filter((target) =>
            selectedTargetIds.has(target.targetId),
          ),
        };
      } else if (blueprintDialoguePreviewPlan) {
        selectedPlan = blueprintDialoguePreviewPlan;
      } else {
        const inspection = await inspectMissionTargetBlueprint(
          blueprintName.trim(),
          undefined,
          undefined,
          undefined,
          configuredDialogueId,
          configuredDialogueTimeline,
        );
        applyBlueprintInspection(inspection, false);
        if (inspection.blueprintState !== "populated") {
          throw new Error("当前 BP 中没有可加载的数字模型槽位");
        }
        if (!inspection.dialoguePreviewPlan) {
          throw new Error(
            inspection.dialoguePreviewBlockedReasons?.join("；") ||
              "无法从对应对话解析 BP 模型坐标",
          );
        }
        selectedPlan = inspection.dialoguePreviewPlan;
        if (dialoguePreviewNodeId) {
          setStatus(
            inspection.dialoguePreviewPlan.dialogueTimeline
              ? `已推演至节点 ${dialoguePreviewNodeId}，请确认俯视图后加载到 UE`
              : `本地对话表中未找到节点 ${dialoguePreviewNodeId}`,
          );
          return;
        }
      }
      if (!plan) {
        const result = await loadMissionTargetPreview(
          selectedPlan,
          "current",
        );
        setStatus(loadSummary(selectedPlan, result, true), "success");
        return;
      }
      const mapStatus = await inspectMissionTargetMap(
        selectedPlan.mapAssetPath,
      );
      if (mapStatus.matches) {
        setTaskLabel("正在加载目标物到 UE");
        const result = await loadMissionTargetPreview(
          selectedPlan,
          "require-current",
        );
        setStatus(loadSummary(selectedPlan, result), "success");
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
    beginTask("正在检查 UE 当前地图");
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
      setTaskLabel("正在加载目标物到 UE");
      const result = await loadMissionTargetPreview(
        mapLoadDecision.plan,
        "require-current",
      );
      setMapLoadDecision(null);
      setStatus(loadSummary(mapLoadDecision.plan, result), "success");
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
    beginTask("正在清除并核对目标物预览");
    setError("");
    setBackgroundPropError("");
    try {
      const result = await clearMissionTargetPreview();
      setStatus(
        result.clearedCount > 0
          ? `已清除 ${result.clearedCount} 个目标物预览对象`
          : "当前没有需要清除的目标物预览",
        result.clearedCount > 0 ? "success" : "ready",
      );
    } catch (clearError) {
      setError(
        (clearError instanceof Error
          ? clearError.message
          : "目标物预览清理失败") + "；请在 UE 核对预览对象是否仍有残留。",
        "uncertain",
      );
    } finally {
      setBusy(false);
    }
  }

  async function inspectBackgroundProps() {
    if (!blueprintName.trim() && !taskId.trim()) {
      return;
    }
    beginTask("正在读取 UE 选择并匹配目标物", "read");
    setError("");
    setStatus("");
    setBackgroundPropError("");
    try {
      let activePlan = plan;
      if (
        taskId.trim() &&
        (!activePlan || activePlan.taskId !== taskId.trim())
      ) {
        activePlan = resolveMissionTargets(database, taskId);
        setPlan(activePlan);
        setSelectedTargetIds(
          new Set(activePlan.targets.map((target) => target.targetId)),
        );
        setBlueprintInspection(null);
      }
      const selection = await readSelectedLevelActors();
      const classification =
        activePlan
          ? classifyMissionTargetSelection(activePlan, selection)
          : null;
      const matchedTargetIds = classification?.matchedTargetIds ?? [];
      const unmatchedActorRefs = classification?.unmatchedActorRefs ?? [];
      setUeTargetSelectionReview(
        activePlan && classification
          ? {
              taskId: activePlan.taskId,
              selection,
              classification,
            }
          : null,
      );
      if (matchedTargetIds.length > 0) {
        setSelectedTargetIds(
          new Set([...existingTargetIds, ...matchedTargetIds]),
        );
        const existingMatchCount = matchedTargetIds.filter((targetId) =>
          existingTargetIds.has(targetId),
        ).length;
        setStatus(
          `已根据 UE 选择勾选 ${matchedTargetIds.length} 个任务目标物，其他可选目标物已取消${
            existingMatchCount > 0
              ? `；其中 ${existingMatchCount} 个已在 BP 中固定保留`
              : ""
          }`,
        );
      }
      if (!blueprintName.trim()) {
        setBackgroundPropPreview(null);
        setSelectedBackgroundActorRefs(new Set());
        setBackgroundMatchedTargetIds([]);
        if (selection.actors.length === 0) {
          setStatus("UE 编辑器中没有选中 Actor");
        } else if (classification && !classification.mapMatches) {
          setStatus(
            `UE 当前地图与任务 ${activePlan?.taskId} 的目标地图不一致，未匹配目标物`,
          );
        } else if (matchedTargetIds.length === 0) {
          setStatus(
            `UE 当前选择未匹配任务 ${activePlan?.taskId} 的目标物`,
          );
        } else if (unmatchedActorRefs.length > 0) {
          setStatus(
            `已识别任务目标物 ${matchedTargetIds.join("、")}；另有 ${unmatchedActorRefs.length} 个 Actor 未匹配`,
          );
        }
        return;
      }
      if (
        matchedTargetIds.length > 0 &&
        unmatchedActorRefs.length === 0
      ) {
        setBackgroundPropPreview(null);
        setSelectedBackgroundActorRefs(new Set());
        setBackgroundMatchedTargetIds([]);
        return;
      }
      const reviewedActorRefs =
        matchedTargetIds.length > 0 ? unmatchedActorRefs : undefined;
      setTaskLabel("正在检查 UE 选择写入 BP 的差异");
      const preview = await inspectBackgroundPropImport(
        blueprintName.trim(),
        reviewedActorRefs,
        configuredDialogueId,
        taskId.trim() || undefined,
      );
      setBackgroundPropPreview(preview);
      setStatus(
        preview.blockedReasons.length || preview.items.some((item) => item.action === "blocked")
          ? "审核存在待处理项，请核对下列原因"
          : "UE 选择审核已就绪，尚未写入 BP",
        preview.blockedReasons.length || preview.items.some((item) => item.action === "blocked") ? "warning" : "ready",
      );
      setBackgroundMatchedTargetIds(matchedTargetIds);
      setSelectedBackgroundActorRefs(
        new Set(
          preview.items
            .filter((item) => item.action !== "blocked")
            .map((item) => item.actorRef),
        ),
      );
    } catch (previewError) {
      setUeTargetSelectionReview(null);
      setBackgroundMatchedTargetIds([]);
      setError(
        previewError instanceof Error
          ? previewError.message
          : "读取 UE 选择失败",
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
    const selectedActorRefs = Array.from(selectedBackgroundActorRefs);
    const reviewedActorRefs = backgroundPropPreview.items.map(
      (item) => item.actorRef,
    );
    const selectedItems = backgroundPropPreview.items.filter((item) =>
      selectedBackgroundActorRefs.has(item.actorRef),
    );
    const dialogueNpcCount = selectedItems.filter(
      (item) => item.importMode === "dialogue_npc",
    ).length;
    const backgroundAssetCount = selectedItems.length - dialogueNpcCount;
    if (
      !window.confirm(
        `将向 ${backgroundPropPreview.blueprintAssetPath} 写入 ${selectedBackgroundCount} 个 UE Actor。` +
          (dialogueNpcCount > 0
            ? `\n${dialogueNpcCount} 个对话 NPC 将按数字槽位顺序写入，并同步对应对话的 DialogModels。`
            : "") +
          (backgroundAssetCount > 0
            ? `\n${backgroundAssetCount} 个背景资产使用资产原名写入。`
            : "") +
          (backgroundAutoConfigurationRequired
            ? "\n将先自动补齐对话 Formation、Preview Level、虚拟场景和主角初始 Transform；现有 DialogModels 保持不变。"
            : "") +
          "\n全部对象均保留位置、旋转和缩放。" +
          "\n不会写入 NPC 表或目标物表。" +
          `\n\n${dialogueNpcCount > 0 ? "BP 与对话资产" : "BP"}将保存，是否继续？`,
      )
    ) {
      setStatus("已取消 UE 选择写入 BP", "cancelled");
      return;
    }
    beginTask(backgroundAutoConfigurationRequired ? "正在补齐对话配置并准备写入 BP" : "正在写入 BP 与对话配置", "background-write");
    setError("");
    let dialogueConfigurationCompleted = false;
    try {
      let activePreview = backgroundPropPreview;
      if (backgroundAutoConfigurationRequired) {
        const configured = await fillBackgroundDialogueConfiguration(
          reviewedActorRefs,
        );
        if (configured.result.spatialStatus === "not_configured") {
          throw new Error(
            "Formation 已补齐，但无法确定 BP 的世界位置。请把该 BP 放入当前地图，或输入任务节点后重试。",
          );
        }
        dialogueConfigurationCompleted = true;
        activePreview = configured.preview;
        if (activePreview.blockedReasons.length > 0) {
          throw new Error(activePreview.blockedReasons.join("；"));
        }
      }
      setTaskLabel("正在写入并核对 BP 内容");
      const result = await applyBackgroundPropImport(
        blueprintName.trim(),
        activePreview.reviewToken,
        selectedActorRefs,
        activePreview.items.map((item) => item.actorRef),
        configuredDialogueId,
        taskId.trim() || undefined,
      );
      setBackgroundPropPreview(null);
      setSelectedBackgroundActorRefs(new Set());
      const selectionPrefix =
        backgroundMatchedTargetIds.length > 0
          ? `已勾选 ${backgroundMatchedTargetIds.length} 个任务目标物；`
          : "";
      setBackgroundMatchedTargetIds([]);
      setStatus(
        selectionPrefix +
          (result.status === "unchanged"
          ? "所选 UE Actor 与 BP、对话模型均已一致"
          : `已写入 BP：新增 ${result.createdComponentNames.length} 个，更新 ${result.updatedComponentNames.length} 个${
              result.dialogueRegistration
                ? `；DialogModels 已注册 ${result.dialogueRegistration.registeredCount} 个角色`
                : ""
            }`),
        result.status === "unchanged" ? "ready" : "success",
      );
    } catch (importError) {
      setBackgroundPropError(
        `${
          importError instanceof Error
            ? importError.message
            : "背景资产写入 BP 失败"
        }${
          dialogueConfigurationCompleted
            ? "；对话空间配置已补齐，BP 写入结果需核对"
            : ""
        }`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function inspectBlueprint() {
    if (!blueprintName.trim()) {
      return;
    }
    beginTask("正在检查 BP、对话模型与位置映射", "check");
    setError("");
    setStatus("");
    try {
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan ?? undefined,
        plan?.taskId,
        targetOverrideItems,
        configuredDialogueId,
        configuredDialogueTimeline,
      );
      applyBlueprintInspection(inspection);
    } catch (inspectionError) {
      setBlueprintInspection(null);
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
    const missingSlots = blueprintInspection.slots.filter(
      (slot) =>
        slot.modelIndex > 0 &&
        slot.status === "unmapped" &&
        (slot.targetId === null || selectedTargetIds.has(slot.targetId)),
    );
    if (missingSlots.length > 0) {
      await openDialogNpcRegistration(missingSlots);
      return;
    }
    const selectedAssetTargetIds = blueprintCreationTargets.map(
      (target) => target.targetId,
    );
    beginTask("正在检查 BP 创建范围");
    setError("");
    setStatus("");
    let writeRequested = false;
    try {
      const compatibility = await checkMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        selectedAssetTargetIds,
        configuredDialogueId,
      );
      if (
        compatibility.status !== "matched" &&
        !window.confirm(
          `${compatibility.message}\n\n创建 BP 将同步更新对话 Formation 和 DialogModels，是否继续？`,
        )
      ) {
        setStatus("已取消创建 BP", "cancelled");
        return;
      }
      setTaskLabel("正在创建 BP 内容并注册对话");
      writeRequested = true;
      const result = await createMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        selectedAssetTargetIds,
        true,
        configuredDialogueId,
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
          registration?.characterCount ??
          (registration?.registeredCount ?? 0) + 1
        } 个角色（含 0 号玩家）${
          registration?.emptyCount
            ? `，${registration.emptyCount} 个所选模型未登记`
            : ""
        }${spatialMessage}`,
        registration?.spatialStatus === "not_configured" || registration?.emptyCount ? "warning" : "success",
      );
      try {
        const inspection = await inspectMissionTargetBlueprint(
          blueprintName.trim(),
          plan,
          plan.taskId,
          targetOverrideItems,
          configuredDialogueId,
          configuredDialogueTimeline,
        );
        applyBlueprintInspection(inspection, false);
      } catch {
        setBlueprintInspection(null);
        setStatus(`BP 已创建并保存，但列表刷新失败；请重新检查 ${result.blueprintAssetPath}。`, "warning");
      }
    } catch (createError) {
      setError(
        (createError instanceof Error
          ? createError.message
          : "创建 BP 内容失败") + (writeRequested ? "；请先核对 UE 资产与未保存内容，再重新检查。" : ""),
        writeRequested ? "uncertain" : "failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function appendBlueprintTargets() {
    if (
      !plan ||
      !blueprintName.trim() ||
      blueprintInspection?.blueprintState !== "populated" ||
      selectedAppendTargets.length === 0
    ) {
      return;
    }
    if (dialogNpcRegistrationSlots.length > 0) {
      await openDialogNpcRegistration();
      return;
    }
    const additions = selectedAppendTargets.map((target) => {
      const slot = blueprintInspection.appendSlots?.find(
        (candidate) => candidate.targetId === target.targetId,
      );
      return `${slot?.modelIndex ?? "?"} = ${target.npcName || target.description || target.targetId}`;
    });
    if (
      !window.confirm(
        `将保留 BP 中现有 ${blueprintRegistrationSlots.length} 个数字槽位，并按顺序追加：\n${additions.join("\n")}` +
          "\n\n新增组件会写入 BP，并将全部 BP 数字槽位注册到对应 DialogModels。BP 与对话资产将保存，是否继续？",
      )
    ) {
      setStatus("已取消追加目标物", "cancelled");
      return;
    }
    beginTask("正在追加 BP 槽位并注册对话");
    setError("");
    setStatus("");
    try {
      const result = await appendMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        selectedAppendTargets.map((target) => target.targetId),
        configuredDialogueId,
      );
      const registration = result.dialogueRegistration;
      const unresolved = registration.unresolvedIndexes.length
        ? `；槽位 ${registration.unresolvedIndexes.join("、")} 未在 DialogNPCTable 登记，保持 None`
        : "";
      setStatus(
        `已追加 BP 槽位 ${result.addedModelIndexes.join("、")}，并注册 ${registration.characterCount} 个对话角色${unresolved}`,
        registration.unresolvedIndexes.length || registration.spatialStatus === "not_configured" ? "warning" : "success",
      );
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        plan.taskId,
        targetOverrideItems,
        configuredDialogueId,
        configuredDialogueTimeline,
      );
      applyBlueprintInspection(inspection, false);
    } catch (appendError) {
      setError(
        (appendError instanceof Error
          ? appendError.message
          : "追加目标物到 BP 失败") + "；请先核对 UE 资产与未保存内容，再重新检查。",
        "uncertain",
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
    const missingSlots = blueprintModelSlots.filter(
      (slot) => slot.status === "unmapped",
    );
    if (missingSlots.length > 0) {
      await openDialogNpcRegistration(missingSlots);
      return;
    }
    beginTask("正在按 BP 槽位注册对话并核对配置");
    setError("");
    setStatus("");
    try {
      const result = await registerBlueprintDialogueModels(
        blueprintName.trim(),
        blueprintModelSlots.map((slot) => slot.modelIndex),
        plan?.taskId,
        targetOverrideItems,
        false,
        configuredDialogueId,
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
        `${result.status === "unchanged" ? "对话模型无需变更" : `已按 BP 槽位注册到对话 ${result.dialogueId}`}：角色 ${result.characterCount ?? result.registeredCount + 1} 个（含 0 号玩家），None ${result.emptyCount} 个${unresolved}${spatialMessage}`,
        result.spatialStatus === "not_configured" || result.unresolvedIndexes.length || result.emptyCount
          ? "warning" : result.status === "unchanged" ? "ready" : "success",
      );
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan ?? undefined,
        plan?.taskId,
        targetOverrideItems,
        configuredDialogueId,
        configuredDialogueTimeline,
      );
      applyBlueprintInspection(inspection, false);
    } catch (registrationError) {
      setError(
        (registrationError instanceof Error
          ? registrationError.message
          : "注册 DialogModels 失败") + "；请先核对 UE 资产与未保存内容，再重新检查。",
        "uncertain",
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
      setStatus("已取消修改 BP 位置", "cancelled");
      return;
    }
    beginTask("正在把目标物位置写入 BP 并核对");
    setError("");
    setStatus("");
    try {
      const result = await updateMissionTargetBlueprintPositions(
        blueprintName.trim(),
        plan.taskId,
        selectedSyncMappings.map((mapping) => mapping.targetId),
        targetOverrideItems,
        configuredDialogueId,
      );
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        plan.taskId,
        targetOverrideItems,
        configuredDialogueId,
        configuredDialogueTimeline,
      );
      applyBlueprintInspection(inspection, false);
      setStatus(
        result.status === "unchanged"
          ? "BP 位置与对话空间配置已是最新"
          : `已更新 BP 槽位 ${result.updatedModelIndexes.join("、") || "无坐标变化"}；对话空间配置已同步`,
        result.status === "unchanged" ? "ready" : "success",
      );
    } catch (updateError) {
      setError(
        (updateError instanceof Error
          ? updateError.message
          : "修改 BP 位置失败") + "；请先核对 UE 资产与未保存内容，再重新检查。",
        "uncertain",
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
      setStatus("已取消从 BP 更新目标物", "cancelled");
      return;
    }
    beginTask("正在把 BP 位置写入目标物 · Excel 将保持未保存");
    setError("");
    setStatus("");
    try {
      const result = await updateMissionTargetsFromBlueprint(
        blueprintName.trim(),
        plan.taskId,
        selectedSyncMappings.map((mapping) => mapping.targetId),
        targetOverrideItems,
        configuredDialogueId,
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
        result.updatedTargets.length > 0 ? "success" : "ready",
      );
    } catch (updateError) {
      setError(
        (updateError instanceof Error
          ? updateError.message
          : "从 BP 更新目标物失败") + "；请先核对 Excel 未保存内容，勿立即重复写入。",
        "uncertain",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleAllTargets() {
    if (!plan) {
      return;
    }
    const lockedTargetIds =
      blueprintInspection?.blueprintState === "populated"
        ? Array.from(existingTargetIds)
        : [];
    setSelectedTargetIds(
      new Set(
        allSelected
          ? lockedTargetIds
          : [
              ...lockedTargetIds,
              ...selectableTargetRows.map((target) => target.targetId),
            ],
      ),
    );
    setStatus("");
  }

  const toggleTarget = useCallback((targetId: string) => {
    if (existingTargetIds.has(targetId)) {
      return;
    }
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
  }, [existingTargetIds, setStatus]);

  function openTargetEditor() {
    if (!plan || selectedCount === 0) {
      return;
    }
    const initialMatches =
      activeUeTargetSelectionReview?.classification.mapMatches
        ? activeUeTargetSelectionReview.classification.matches.filter(
            (match) => selectedTargetIds.has(match.targetId),
          )
        : [];
    setEditRequest({
      taskId: plan.taskId,
      mapId: plan.mapId,
      mapAssetPath: plan.mapAssetPath,
      targets: plan.targets.filter((target) =>
        selectedTargetIds.has(target.targetId),
      ),
      ...(initialMatches.length > 0 && activeUeTargetSelectionReview
        ? {
            initialSelection: activeUeTargetSelectionReview.selection,
            initialMatches,
          }
        : {}),
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
    setUeTargetSelectionReview(null);
    setStatus(`已修改 ${items.length} 个目标物的位置或旋转（Excel 未保存）`, "success");
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
  const taskNotice = feedback.message ? (
    <TaskNotice {...feedback} animate={!activeOperation} className="mission-target-message">{feedback.message}</TaskNotice>
  ) : null;
  const readUeSelectionButton = (
    <button
      className={embedded ? "button workspace-floating-command" : "button"}
      type="button"
      onClick={() => void inspectBackgroundProps()}
      disabled={
        busy ||
        (!taskId.trim() && !blueprintName.trim()) ||
        blueprintInputIsDialogueNode ||
        !dialogueNodeInputValid
      }
      title={
        blueprintInputIsDialogueNode
          ? "六位对话节点 ID 请填写到 BP 右侧的展开输入框"
          : !dialogueNodeInputValid
            ? "对话节点 ID 必须为六位数字"
            : taskId.trim()
              ? plan
                ? blueprintName.trim()
                  ? "读取 UE 当前选择，匹配任务目标物并审核未匹配资源"
                  : "读取 UE 当前选择并识别任务目标物"
                : "解析任务节点并识别 UE 当前选择"
              : blueprintName.trim()
                ? "读取 UE 当前选择，审核后直接写入当前 BP"
                : "请先输入任务节点或填写 BP 文件名"
      }
    >
      <OperationIcon kind="read" busy={activeOperation === "read"}><RefreshCw size={16} /></OperationIcon>
      读取 UE 选择
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
            {readUeSelectionButton}
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
            <div className="npc-registration-header-actions">
              {readUeSelectionButton}
              {returnButton}
            </div>
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
                setUeTargetSelectionReview(null);
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
              disabled={
                busy ||
                !taskId ||
                blueprintInputIsDialogueNode ||
                !dialogueNodeInputValid
              }
            >
              <OperationIcon kind="search" busy={activeOperation === "search"}><Search size={18} /></OperationIcon>
            </button>
          </div>
          <label htmlFor="mission-blueprint-name">BP 文件名</label>
          <div
            className="mission-target-blueprint-fields"
            data-dialogue-expanded={dialogueIdExpanded}
          >
            <div className="input-row">
              <input
                id="mission-blueprint-name"
                value={blueprintName}
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.value;
                  setBlueprintName(value);
                  setDialogueId("");
                  setBlueprintInspection(null);
                  setError(
                    /^\d{6}$/.test(value.trim())
                      ? "六位对话节点 ID 请填写到 BP 右侧的展开输入框"
                      : "",
                  );
                  setStatus("");
                }}
                placeholder="7370、BP_737000 或 /Game/.../BP_737000"
                spellCheck={false}
                aria-invalid={blueprintInputIsDialogueNode}
              />
              <button
                className="icon-button"
                type="button"
                aria-label="检查 BP 与对话模型"
                onClick={() => void inspectBlueprint()}
                disabled={
                  busy ||
                  !blueprintName.trim() ||
                  blueprintInputIsDialogueNode ||
                  !dialogueNodeInputValid
                }
                title={
                  blueprintInputIsDialogueNode
                    ? "六位对话节点 ID 请填写到右侧展开输入框"
                    : !dialogueNodeInputValid
                      ? "对话节点 ID 必须为六位数字"
                      : "检查 BP 与对话模型"
                }
              >
                <OperationIcon kind="search" busy={activeOperation === "check"}><FileSearch size={18} /></OperationIcon>
              </button>
            </div>
            <button
              className="mission-target-dialogue-toggle"
              type="button"
              data-has-value={Boolean(dialogueId)}
              aria-expanded={dialogueIdExpanded}
              aria-controls="mission-dialogue-id"
              aria-label={`${dialogueIdExpanded ? "收起" : "展开"}对话节点 ID${
                dialogueId ? `，当前 ${dialogueId}` : ""
              }`}
              title={`${dialogueIdExpanded ? "收起" : "展开"}对话节点 ID${
                dialogueId ? `（当前 ${dialogueId}）` : ""
              }`}
              onClick={() =>
                setDialogueIdExpanded((current) => !current)
              }
            >
              {dialogueIdExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </button>
            {dialogueIdExpanded && (
              <input
                id="mission-dialogue-id"
                aria-label="对话节点 ID（可选）"
                inputMode="numeric"
                value={dialogueId}
                disabled={busy}
                onChange={(event) => {
                  setDialogueId(
                    event.target.value.replace(/\D/g, "").slice(0, 6),
                  );
                  setBlueprintInspection(null);
                  setBackgroundPropPreview(null);
                  setSelectedBackgroundActorRefs(new Set());
                  setError("");
                  setStatus("");
                }}
                placeholder="输入 6 位节点 ID"
                aria-invalid={!dialogueNodeInputValid}
                autoFocus
              />
            )}
          </div>
        </form>

        <OverlayScrollArea className="mission-target-body">
          {!backgroundPropPreview && !mapLoadDecision && !dialogNpcReview && taskNotice}
          {blueprintInspection && dialogNpcRegistrationSlots.length > 0 && (
            <section className="mission-target-dialog-npc-warning">
              <span>
                <AlertTriangle size={15} />
                <strong>
                  {dialogNpcRegistrationSlots.length} 个槽位未登记
                </strong>
                <small>DialogModels 将保持 None</small>
              </span>
              <button
                className="button"
                type="button"
                onClick={() => void openDialogNpcRegistration()}
                disabled={busy}
              >
                <Database size={15} />
                补登记
              </button>
            </section>
          )}
          {isDialogueRegistration && blueprintInspection && (
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
                    <dt>{plan ? "注册策略" : "当前流程"}</dt>
                    <dd>
                      {plan
                        ? "保留现有并按序追加"
                        : blueprintDialoguePreviewPlan?.dialogueTimeline
                          ? `调度至 ${blueprintDialoguePreviewPlan.dialogueTimeline.finalDialogueId}`
                          : "BP 注册到对话"}
                    </dd>
                  </div>
                  <div>
                    <dt>角色位 / 已注册</dt>
                    <dd>
                      {blueprintRegistrationSlots.length} /{" "}
                      {
                        blueprintRegistrationSlots.filter(
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
              {blueprintDialoguePreviewPlan && (
                <MissionTargetDialoguePreview
                  plan={blueprintDialoguePreviewPlan}
                />
              )}
              <button
                className="mission-target-section-label mission-target-section-toggle"
                type="button"
                aria-expanded={existingSlotsExpanded}
                aria-controls="mission-target-existing-slots"
                aria-label={`${existingSlotsExpanded ? "收起" : "展开"} BP 已有内容`}
                onClick={() => setExistingSlotsExpanded((current) => !current)}
              >
                <span className="mission-target-section-toggle__title">
                  {existingSlotsExpanded ? (
                    <ChevronDown size={15} />
                  ) : (
                    <ChevronRight size={15} />
                  )}
                  <strong>BP 已有内容</strong>
                </span>
                <span>
                  {blueprintRegistrationSlots.length} 个固定槽位 · 不重新编号
                </span>
              </button>
              {existingSlotsExpanded && (
                <div
                  className="mission-target-table-wrap"
                  id="mission-target-existing-slots"
                >
                  <table className="mission-target-table mission-target-dialogue-table">
                    <thead>
                      <tr>
                        <th className="mission-target-select">
                          <input
                            type="checkbox"
                            checked
                            disabled
                            readOnly
                            aria-label="已有 BP 模型固定保留"
                          />
                        </th>
                        <th>槽位</th>
                        <th>BP 模型资源</th>
                        <th>DialogNPCTable 名称</th>
                        <th>对话状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blueprintRegistrationSlots.map((slot) => {
                        const label = dialogueModelLabel(slot, true);
                        return (
                          <tr
                            className="mission-target-row--existing"
                            key={slot.modelIndex}
                          >
                            <td className="mission-target-select">
                              <input
                                type="checkbox"
                                checked
                                disabled
                                readOnly
                                aria-label={`BP 已有槽位 ${slot.modelIndex} 固定保留`}
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
                              <span className="dialogue-model-status dialogue-model-status--registered">
                                BP 已有
                              </span>
                              <small>{label.status}</small>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {!plan &&
            isDialogueRegistration &&
            Boolean(dialoguePreviewNodeId) &&
            (blueprintInspection.dialoguePreviewBlockedReasons?.length ??
              0) > 0 && (
              <section className="mission-target-warnings">
                {blueprintInspection.dialoguePreviewBlockedReasons?.map(
                  (warning) => (
                    <p key={warning}>
                      <AlertTriangle size={14} />
                      <span>{warning}</span>
                    </p>
                  ),
                )}
              </section>
            )}
          {!plan &&
            blueprintDialoguePreviewPlan &&
            blueprintDialoguePreviewPlan.warnings.length > 0 && (
              <section className="mission-target-warnings">
                {blueprintDialoguePreviewPlan.warnings.map((warning) => (
                  <p key={warning}>
                    <AlertTriangle size={14} />
                    <span>{warning}</span>
                  </p>
                ))}
              </section>
            )}
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

              {activeUeTargetSelectionReview && (
                <section
                  className={`mission-target-ue-selection ${
                    activeUeTargetSelectionReview.classification.mapMatches
                      ? ""
                      : "is-warning"
                  }`}
                  aria-label="UE 当前选择识别结果"
                >
                  <header>
                    <span>
                      <Crosshair size={15} />
                      <strong>UE 当前选择</strong>
                    </span>
                    <small title={activeUeTargetSelectionReview.selection.mapAssetPath}>
                      {activeUeTargetSelectionReview.classification.mapMatches
                        ? `${activeUeTargetSelectionReview.classification.matches.length} / ${activeUeTargetSelectionReview.selection.actors.length} 已匹配`
                        : "地图不一致"}
                    </small>
                  </header>
                  <div className="mission-target-ue-selection__list">
                    {activeUeTargetSelectionReview.selection.actors.length ===
                    0 ? (
                      <p>UE 编辑器中没有选中 Actor</p>
                    ) : (
                      activeUeTargetSelectionReview.selection.actors.map(
                        (actor) => {
                          const match = matchesByActorRef.get(actor.actorRef);
                          const target = match
                            ? targetsById.get(match.targetId)
                            : null;
                          return (
                            <div
                              className={`mission-target-ue-selection__item ${
                                target ? "" : "is-unmatched"
                              }`}
                              key={actor.actorRef}
                            >
                              <span title={actor.actorRef}>
                                <strong>{actor.label}</strong>
                                <small>
                                  {actor.classPath.split("/").at(-1)}
                                </small>
                              </span>
                              <ArrowRight size={14} />
                              {target ? (
                                <>
                                  <span>
                                    <strong>目标物 {target.targetId}</strong>
                                    <small>
                                      {target.type === 1
                                        ? `${target.npcName || target.description || "未知 NPC"}${
                                            target.npcId
                                              ? ` · NPC ${target.npcId}`
                                              : ""
                                          }`
                                        : `${typeLabel(target.type)} · ${
                                            target.description || "未填写描述"
                                          }`}
                                    </small>
                                  </span>
                                  <small className="mission-target-ue-selection__method">
                                    {match?.method === "preview_identity"
                                      ? "预览标识"
                                      : "模型与位置"}
                                  </small>
                                </>
                              ) : (
                                <span>
                                  <strong>未匹配</strong>
                                  <small>
                                    {activeUeTargetSelectionReview
                                      .classification.mapMatches
                                      ? "不属于当前任务目标物"
                                      : "当前 UE 地图与任务地图不一致"}
                                  </small>
                                </span>
                              )}
                            </div>
                          );
                        },
                      )
                    )}
                  </div>
                </section>
              )}

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

              {isDialogueRegistration && (
                <div className="mission-target-section-label">
                  <strong>可追加目标物</strong>
                  <span>按任务顺序追加到现有槽位之后</span>
                </div>
              )}
              {targetRows.length > 0 ? (
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
                                   selectedTargetRowCount > 0 && !allSelected;
                               }
                             }}
                             onChange={toggleAllTargets}
                             disabled={
                               busy || selectableTargetRows.length === 0
                             }
                             aria-label={
                               isDialogueRegistration
                                 ? "选择全部可追加目标物"
                                 : "选择全部目标物"
                             }
                           />
                         </th>
                         <th>目标物</th>
                         <th>类型</th>
                         <th>NPC</th>
                         <th>模型资源</th>
                         <th>闲话 / 冒泡</th>
                         <th>位置</th>
                         <th>旋转</th>
                         <th>预览</th>
                         <th>对话模型</th>
                       </tr>
                     </thead>
                     <tbody>
                       {targetRows.map((target) => {
                         const appendSlot = appendSlotsByTargetId.get(target.targetId);
                         const slot = isDialogueRegistration
                           ? appendSlot
                           : slotsByTargetId.get(target.targetId);
                         const selected =
                           selectedTargetIds.has(target.targetId);
                         const appendable =
                           target.previewKind === "asset" &&
                           Boolean(target.modelClassPath);
                         const selectedBlueprintIndex = isDialogueRegistration
                           ? selected
                             ? maximumBlueprintModelIndex +
                               (appendIndexByTargetId.get(target.targetId) ?? -1) +
                               1
                             : undefined
                           : (creationIndexByTargetId.get(target.targetId) ?? -1) + 1;
                         const label = isDialogueRegistration
                           ? !appendable
                             ? {
                                 name: "-",
                                 status: "不可追加",
                                 tone: "warning",
                               }
                             : !selected
                               ? {
                                   name: "-",
                                   status: "不添加",
                                   tone: "empty",
                                 }
                               : appendSlot?.status === "unmapped"
                                 ? {
                                     name: "None",
                                     status: "未登记",
                                     tone: "warning",
                                   }
                                 : {
                                     name:
                                       appendSlot?.suggestedModelName ?? "-",
                                     status: "待追加",
                                     tone: "pending",
                                   }
                           : dialogueModelLabel(slot, selected, true);
                         return (
                          <MissionTargetRow key={target.targetId} target={target}
                            selected={selected} ueSelected={ueSelectedTargetIds.has(target.targetId)}
                            disabled={busy || (isDialogueRegistration && !appendable)}
                            blueprintIndex={selectedBlueprintIndex}
                            modelName={label.name} status={label.status} tone={label.tone}
                            onToggle={toggleTarget} />
                         );
                       })}
                     </tbody>
                  </table>
                </div>
              ) : isDialogueRegistration ? (
                <div className="mission-target-empty mission-target-empty--compact">
                  <CheckCircle2 size={24} />
                  <strong>任务目标物已全部存在于 BP</strong>
                  <small>可直接执行按 BP 注册到对话</small>
                </div>
              ) : null}
            </>
          ) : !isDialogueRegistration ? (
            <div className="mission-target-empty">
              <Boxes size={28} />
              <strong>尚未解析任务节点</strong>
              <small>
                {blueprintInspection
                  ? "当前 BP 为空，请解析任务节点后选择目标物"
                  : `当前数据源包含 ${database.missionRows.length.toLocaleString()} 个任务节点`}
              </small>
            </div>
          ) : null}
        </OverlayScrollArea>

        <footer>
          <span>
            {isDialogueRegistration
              ? plan
                ? `BP 已有 ${blueprintRegistrationSlots.length} 个固定角色位；待追加 ${selectedAppendTargets.length} / ${selectableTargetRows.length} 个目标物`
                : blueprintDialoguePreviewPlan
                  ? blueprintDialoguePreviewPlan.dialogueTimeline
                    ? `对话 ${blueprintDialoguePreviewPlan.taskId} 已推演至节点 ${blueprintDialoguePreviewPlan.dialogueTimeline.finalDialogueId}；${blueprintDialoguePreviewPlan.dialogueTimeline.adjustedCharacterCount} 位角色发生调度`
                    : `BP 已有 ${blueprintRegistrationSlots.length} 个固定角色位`
                  : `BP 已有 ${blueprintRegistrationSlots.length} 个固定角色位；可注册到对话`
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
            {isDialogueRegistration && canUpdateBlueprint && (
              <button
                className="button"
                type="button"
                onClick={() => void updateBlueprintPositions()}
                disabled={
                  busy ||
                  !plan ||
                  selectedSyncMappings.length === 0
                }
                title="从最新目标物配置更新 BP 模型位置和对话空间配置"
              >
                <ArrowRightLeft size={15} />
                目标物 → BP
              </button>
            )}
            {(plan || dialoguePreviewNodeId) && (
              <button
                className="button"
                type="button"
                onClick={() => void loadPreview()}
                disabled={
                  busy ||
                  (plan
                    ? selectedCount === 0
                    : !blueprintName.trim())
                }
                title={
                  plan
                    ? "按任务目标物坐标加载所选预览"
                    : hasDialoguePositionPreview
                      ? "把俯视图中的节点站位加载到当前 UE 关卡，并自动选中变更角色"
                      : "读取 BP 和对话调度并生成指定节点站位俯视图"
                }
              >
                <MapPinned size={16} />
                {plan
                    ? "加载到 UE"
                    : hasDialoguePositionPreview
                      ? "写入到 UE"
                      : "计算节点站位"}
              </button>
            )}
            {!hasDialoguePositionPreview && (
              <button
                className="button button--primary"
                type="button"
                onClick={() =>
                  void (isDialogueRegistration
                    ? selectedAppendTargets.length > 0
                      ? appendBlueprintTargets()
                      : registerDialogue()
                    : createBlueprint())
                }
                disabled={
                  busy ||
                  !blueprintName.trim() ||
                  blueprintInputIsDialogueNode ||
                  !dialogueNodeInputValid ||
                  !blueprintInspection ||
                  (isDialogueRegistration
                    ? blueprintRegistrationSlots.length === 0
                    : !plan ||
                      blueprintInspection.blueprintState !== "empty" ||
                      selectedAssetTargets.length === 0)
                }
                title={
                  isDialogueRegistration
                    ? selectedAppendTargets.length > 0
                      ? "保留现有 BP 槽位，按顺序追加所选目标物并注册全部 DialogModels"
                      : "读取 BP 全部数字槽位并按原序写入 DialogModels"
                    : "向空 PositionMode BP 写入所选资产并注册 DialogModels"
                }
              >
                {selectedAppendTargets.length > 0 ||
                  !isDialogueRegistration ? (
                  <PackagePlus size={16} />
                ) : (
                  <Link2 size={16} />
                )}
                {isDialogueRegistration
                    ? selectedAppendTargets.length > 0
                      ? "添加到 BP 并注册"
                      : "按 BP 注册到对话"
                    : "创建 BP"}
              </button>
            )}
          </div>
        </footer>

        {dialogNpcReview && (
          <DialogNpcRegistrationModal
            review={dialogNpcReview}
            busy={dialogNpcRegistrationBusy}
            feedback={feedback}
            error={dialogNpcRegistrationError}
            onClose={() => {
              setDialogNpcReview(null);
              setDialogNpcRegistrationError("");
            }}
            onSubmit={(rows) => void saveDialogNpcRegistration(rows)}
          />
        )}

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
                  <small>跳过 NPC 与目标物配表</small>
                  <h3 id="background-prop-title">UE 选择写入 BP</h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭 UE 选择写入 BP"
                  onClick={() => {
                    setBackgroundPropPreview(null);
                    setSelectedBackgroundActorRefs(new Set());
                    setBackgroundMatchedTargetIds([]);
                    setBackgroundPropError("");
                    setStatus("已取消 UE 选择写入 BP", "cancelled");
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
                {backgroundMatchedTargetIds.length > 0 && (
                  <span className="background-prop-choice__routing">
                    已识别任务目标物{" "}
                    <code>{backgroundMatchedTargetIds.join("、")}</code>
                    ，下列未匹配 Actor 按实际类型审核
                  </span>
                )}
                {backgroundAutoConfigurationRequired && (
                  <span className="background-prop-choice__routing">
                    写入时将自动补齐对话配置：
                    {backgroundDialogueSetupReasons.join("、")}
                  </span>
                )}
              </div>
              {backgroundBlockingReasons.length > 0 && (
                <div
                  className="mission-map-choice__error"
                  role="alert"
                >
                  <AlertTriangle size={15} />
                  <span>
                    {backgroundBlockingReasons.join("；")}
                  </span>
                </div>
              )}
              {backgroundPropError && !busy
                ? <TaskNotice phase="uncertain" runId={feedback.runId} className="mission-target-message">
                    {backgroundPropError}；请先核对 UE 资产状态，再重新检查。
                  </TaskNotice>
                : taskNotice}
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
                          disabled={busy}
                          aria-label="选择全部 UE Actor"
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
                    {backgroundPropPreview.willCreatePlayerSlot &&
                      selectedDialogueNpcCount > 0 && (
                        <tr>
                          <td className="mission-target-select">
                            <input
                              type="checkbox"
                              checked
                              disabled
                              readOnly
                              aria-label="固定补建 0 号玩家"
                            />
                          </td>
                          <td
                            title="/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C"
                          >
                            <strong>玩家</strong>
                            <small>BP_Eric</small>
                          </td>
                          <td>玩家 BP</td>
                          <td>
                            <code>0</code>
                            <small>DialogModels：player</small>
                          </td>
                          <td>
                            <code>
                              {[
                                backgroundPropPreview.rootTransform.location.x,
                                backgroundPropPreview.rootTransform.location.y,
                                backgroundPropPreview.rootTransform.location.z +
                                  100,
                              ]
                                .map((value) => value.toFixed(1))
                                .join(", ")}
                            </code>
                          </td>
                          <td>
                            <code>1.00, 1.00, 1.00</code>
                          </td>
                          <td title="自动补建固定 0 号玩家 BP_Eric">
                            <span className="dialogue-model-status dialogue-model-status--pending">
                              新增
                            </span>
                          </td>
                        </tr>
                      )}
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
                              disabled={blocked || busy}
                              onChange={() =>
                                toggleBackgroundProp(item.actorRef)
                              }
                              aria-label={`选择 UE Actor ${item.actorLabel}`}
                            />
                          </td>
                          <td title={item.actorRef}>
                            <strong>{item.actorLabel}</strong>
                            <small title={item.assetPath}>
                              {item.assetPath || item.message}
                            </small>
                          </td>
                          <td>
                            {item.importMode === "dialogue_npc"
                              ? "SceneObject NPC"
                              : backgroundPropKindLabel(item.assetKind)}
                          </td>
                          <td>
                            <code>{item.componentName || "-"}</code>
                            {item.importMode === "dialogue_npc" && (
                              <small>
                                DialogModels：
                                {item.dialogueModelName ?? "None"}
                              </small>
                            )}
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
                            {blocked && <small>{item.message}</small>}
                          </td>
                        </tr>
                      );
                    })}
                    {backgroundPropPreview.willCreateCameraSlot &&
                      selectedDialogueNpcCount > 0 && (
                        <tr>
                          <td className="mission-target-select">
                            <input
                              type="checkbox"
                              checked
                              disabled
                              readOnly
                              aria-label="固定补建 c1 摄像机"
                            />
                          </td>
                          <td title="/Script/Engine.CameraComponent">
                            <strong>摄像机</strong>
                            <small>CameraComponent</small>
                          </td>
                          <td>摄像机</td>
                          <td>
                            <code>c1</code>
                            <small>Formation Camera</small>
                          </td>
                          <td>
                            <code>
                              {[
                                backgroundPropPreview.rootTransform.location.x,
                                backgroundPropPreview.rootTransform.location.y,
                                backgroundPropPreview.rootTransform.location.z +
                                  99,
                              ]
                                .map((value) => value.toFixed(1))
                                .join(", ")}
                            </code>
                          </td>
                          <td>
                            <code>1.00, 1.00, 1.00</code>
                          </td>
                          <td title="自动补建固定 c1 摄像机组件">
                            <span className="dialogue-model-status dialogue-model-status--pending">
                              新增
                            </span>
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
              <footer>
                <span>
                  已选择 {selectedBackgroundCount} /{" "}
                  {selectableBackgroundItems.length} 个可写入 Actor
                </span>
                <div>
                  {backgroundDialogueSetupReasons.length > 0 &&
                    !backgroundAutoConfigurationRequired && (
                    <button
                      className="button"
                      type="button"
                      onClick={() => void configureBackgroundDialogue()}
                      disabled={busy}
                      title="保留 DialogModels，只补齐当前 BP 所需的对话空间字段"
                    >
                      <Link2 size={15} />
                      补齐对话配置
                    </button>
                  )}
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setBackgroundPropPreview(null);
                      setSelectedBackgroundActorRefs(new Set());
                      setBackgroundMatchedTargetIds([]);
                      setBackgroundPropError("");
                      setStatus("已取消 UE 选择写入 BP", "cancelled");
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
                      backgroundBlockingReasons.length > 0
                    }
                  >
                    <OperationIcon kind="write" busy={activeOperation === "background-write"}><PencilLine size={15} /></OperationIcon>
                    {busy
                      ? "正在写入..."
                      : backgroundAutoConfigurationRequired
                        ? "补齐并写入 BP 与对话"
                        : selectedDialogueNpcCount > 0
                          ? "写入 BP 与对话"
                          : "写入 BP"}
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
                  <small>UE 当前关卡与预览地图不同</small>
                  <h3 id="mission-map-choice-title">
                    {mapLoadDecision.phase === "auto"
                      ? "正在等待 UE 加载地图"
                      : mapLoadDecision.phase === "verify"
                        ? "等待 UE 完成地图加载"
                      : mapLoadDecision.phase === "manual"
                        ? "等待手动切换地图"
                        : "选择地图加载方式"}
                  </h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title="取消"
                  aria-label="取消地图加载"
                  onClick={() => {
                    setMapLoadDecision(null);
                    setStatus("已取消地图加载", "cancelled");
                  }}
                  disabled={busy}
                >
                  <X size={17} />
                </button>
              </header>

              {busy && taskNotice}
              <div className="mission-map-choice__body">
                <dl>
                  <div>
                    <dt>UE 当前关卡</dt>
                    <dd title={mapLoadDecision.currentMapAssetPath}>
                      {mapLoadDecision.currentMapAssetPath}
                    </dd>
                  </div>
                  <div>
                    <dt>目标地图</dt>
                    <dd title={mapLoadDecision.plan.mapAssetPath}>
                      {mapLoadDecision.plan.mapName} ·{" "}
                      {mapLoadDecision.plan.mapAssetPath}
                    </dd>
                  </div>
                </dl>
                {mapLoadDecision.phase === "manual" && (
                  <p>
                    请在 UE 中完成地图切换，再检查并加载预览。
                  </p>
                )}
                {mapLoadDecision.phase === "auto" && (
                  <p>
                    UE 正在打开目标地图。大型关卡可能需要数十秒，加载完成后会继续生成预览对象。
                  </p>
                )}
                {mapLoadDecision.phase === "verify" && (
                  <p>
                    地图切换请求已经送达 UE；等待关卡稳定后再检查并加载目标物。
                  </p>
                )}
                {mapLoadDecision.error && (
                  <div
                    className={`mission-map-choice__error ${
                      mapLoadDecision.phase === "verify" ? "is-pending" : ""
                    }`}
                    role={
                      mapLoadDecision.phase === "verify" ? "status" : "alert"
                    }
                  >
                    {mapLoadDecision.phase === "verify" ? (
                      <MapPinned size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                    <span>{mapLoadDecision.error}</span>
                  </div>
                )}
              </div>

              <footer>
                {mapLoadDecision.phase === "auto" ? (
                  <button
                    className="button button--primary"
                    type="button"
                    disabled
                  >
                    <MapPinned size={15} />
                    正在等待 UE 加载
                  </button>
                ) : mapLoadDecision.phase === "choose" ? (
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
                      <MapPinned size={15} />
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
                      <CheckCircle2 size={15} />
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
