import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Link2,
  LoaderCircle,
  MapPinned,
  MonitorUp,
  PackagePlus,
  PencilLine,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { NpcRegistrationModal } from "./NpcRegistrationModal";
import { resolveMissionTargets } from "../data/missionTargetResolver";
import { classifyMissionTargetSelection } from "../data/missionTargetSelection";
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
  appendMissionTargetBlueprint,
  applyBackgroundPropImport,
  clearMissionTargetPreview,
  checkMissionTargetBlueprint,
  createMissionTargetBlueprint,
  inspectMissionTargetMap,
  inspectMissionTargetBlueprint,
  inspectBackgroundPropImport,
  loadMissionTargetPreview,
  readSelectedLevelActors,
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
  const [existingSlotsExpanded, setExistingSlotsExpanded] = useState(false);
  const [backgroundPropError, setBackgroundPropError] = useState("");
  const [mapLoadDecision, setMapLoadDecision] =
    useState<MapLoadDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const selectedCount =
    plan?.targets.filter((target) => selectedTargetIds.has(target.targetId))
      .length ?? 0;
  const isDialogueRegistration =
    blueprintInspection?.blueprintState === "populated";
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

  function applyBlueprintInspection(
    inspection: MissionTargetBlueprintInspection,
    updateStatus = true,
  ) {
    setBlueprintInspection(inspection);
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
    if (inspection.blueprintState === "populated") {
      setSelectedTargetIds(
        new Set(
          inspection.sync?.mappings.map((mapping) => mapping.targetId) ?? [],
        ),
      );
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
    setBackgroundPropError("");
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

  async function configureBackgroundDialogue() {
    if (!blueprintName.trim()) {
      return;
    }
    const matchedTargetIds = backgroundMatchedTargetIds;
    if (
      !window.confirm(
        "将补齐当前 BP 对应对话的 Formation、Preview Level、虚拟场景和主角初始 Transform。" +
          "\n现有 DialogModels 保持不变。" +
          "\n\n对话资产将保存，是否继续？",
      )
    ) {
      return;
    }
    setBusy(true);
    setBackgroundPropError("");
    setError("");
    setStatus("");
    try {
      const result = await registerBlueprintDialogueModels(
        blueprintName.trim(),
        [],
        plan?.taskId,
        targetOverrideItems,
        true,
      );
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan ?? undefined,
        plan?.taskId,
        targetOverrideItems,
      );
      applyBlueprintInspection(inspection, false);
      if (matchedTargetIds.length > 0) {
        const refreshedExistingTargetIds =
          inspection.sync?.mappings.map((mapping) => mapping.targetId) ?? [];
        setSelectedTargetIds(
          new Set([...refreshedExistingTargetIds, ...matchedTargetIds]),
        );
      }
      const reviewedActorRefs =
        backgroundPropPreview?.items.map((item) => item.actorRef) ?? [];
      const preview = await inspectBackgroundPropImport(
        blueprintName.trim(),
        reviewedActorRefs.length > 0 ? reviewedActorRefs : undefined,
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
      if (result.spatialStatus === "not_configured") {
        setBackgroundPropError(
          "Formation 已补齐，但无法确定 BP 的世界位置。请把该 BP 放入当前地图，或输入任务节点后重试。",
        );
      } else {
        setStatus("已补齐对话空间配置，并重新读取 UE 当前选择");
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
    setBackgroundPropError("");
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
    setBackgroundPropError("");
    try {
      const selection = await readSelectedLevelActors();
      const classification =
        plan && selection.actors.length > 0
          ? classifyMissionTargetSelection(plan, selection)
          : null;
      const matchedTargetIds = classification?.matchedTargetIds ?? [];
      const unmatchedActorRefs = classification?.unmatchedActorRefs ?? [];
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
      const preview = await inspectBackgroundPropImport(
        blueprintName.trim(),
        reviewedActorRefs,
      );
      setBackgroundPropPreview(preview);
      setBackgroundMatchedTargetIds(matchedTargetIds);
      setSelectedBackgroundActorRefs(
        new Set(
          preview.items
            .filter((item) => item.action !== "blocked")
            .map((item) => item.actorRef),
        ),
      );
    } catch (previewError) {
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
    if (
      !window.confirm(
        `将向 ${backgroundPropPreview.blueprintAssetPath} 写入 ${selectedBackgroundCount} 个 UE Actor。` +
          "\n组件使用资产原名，并保留位置、旋转和缩放。" +
          "\n不会写入 NPC 表或目标物表。" +
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
        backgroundPropPreview.items.map((item) => item.actorRef),
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
          ? "所选 UE Actor 已经与 BP 一致"
          : `已直接写入 BP：新增 ${result.createdComponentNames.length} 个，更新 ${result.updatedComponentNames.length} 个`),
      );
    } catch (importError) {
      setBackgroundPropError(
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
    const selectedAssetTargetIds = selectedAssetTargets.map(
      (target) => target.targetId,
    );
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const compatibility = await checkMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        selectedAssetTargetIds,
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
        selectedAssetTargetIds,
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
          registration?.characterCount ??
          (registration?.registeredCount ?? 0) + 1
        } 个角色（含 0 号玩家）${
          registration?.emptyCount
            ? `，${registration.emptyCount} 个所选模型未登记`
            : ""
        }${spatialMessage}`,
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

  async function appendBlueprintTargets() {
    if (
      !plan ||
      !blueprintName.trim() ||
      blueprintInspection?.blueprintState !== "populated" ||
      selectedAppendTargets.length === 0
    ) {
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
      setStatus("已取消追加目标物");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await appendMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        selectedAppendTargets.map((target) => target.targetId),
      );
      const registration = result.dialogueRegistration;
      const unresolved = registration.unresolvedIndexes.length
        ? `；槽位 ${registration.unresolvedIndexes.join("、")} 未在 DialogNPCTable 登记，保持 None`
        : "";
      setStatus(
        `已追加 BP 槽位 ${result.addedModelIndexes.join("、")}，并注册 ${registration.characterCount} 个对话角色${unresolved}`,
      );
      const inspection = await inspectMissionTargetBlueprint(
        blueprintName.trim(),
        plan,
        plan.taskId,
        targetOverrideItems,
      );
      applyBlueprintInspection(inspection, false);
    } catch (appendError) {
      setError(
        appendError instanceof Error
          ? appendError.message
          : "追加目标物到 BP 失败",
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
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await registerBlueprintDialogueModels(
        blueprintName.trim(),
        blueprintModelSlots.map((slot) => slot.modelIndex),
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
        `${result.status === "unchanged" ? "对话模型无需变更" : `已按 BP 槽位注册到对话 ${result.dialogueId}`}：角色 ${result.characterCount ?? result.registeredCount + 1} 个（含 0 号玩家），None ${result.emptyCount} 个${unresolved}${spatialMessage}`,
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

  function toggleTarget(targetId: string) {
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
  const readUeSelectionButton = (
    <button
      className={embedded ? "button workspace-floating-command" : "button"}
      type="button"
      onClick={() => void inspectBackgroundProps()}
      disabled={busy || !blueprintName.trim()}
      title={
        blueprintName.trim()
          ? plan
            ? "读取 UE 当前选择，匹配任务目标物并审核未匹配资源"
            : "读取 UE 当前选择，审核后直接写入当前 BP"
          : "请先填写 BP 文件名"
      }
    >
      {busy ? (
        <LoaderCircle className="spin" size={16} />
      ) : (
        <RefreshCw size={16} />
      )}
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
                setError("");
                setStatus("");
              }}
              placeholder="7351、BP_735100 或 /Game/.../BP_735100"
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
                    <dt>注册策略</dt>
                    <dd>保留现有并按序追加</dd>
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
                         <th>位置</th>
                         <th>旋转</th>
                         <th>预览</th>
                         <th>对话模型</th>
                       </tr>
                     </thead>
                     <tbody>
                       {targetRows.map((target) => {
                         const appendSlot =
                           blueprintInspection?.appendSlots?.find(
                             (item) => item.targetId === target.targetId,
                           );
                         const slot = isDialogueRegistration
                           ? appendSlot
                           : blueprintInspection?.slots.find(
                               (item) => item.targetId === target.targetId,
                             );
                         const selected =
                           selectedTargetIds.has(target.targetId);
                         const appendable =
                           target.previewKind === "asset" &&
                           Boolean(target.modelClassPath);
                         const selectedBlueprintIndex = isDialogueRegistration
                           ? selected
                             ? maximumBlueprintModelIndex +
                               selectedAppendTargets.findIndex(
                                 (item) =>
                                   item.targetId === target.targetId,
                               ) +
                               1
                             : undefined
                           : selectedAssetTargets.findIndex(
                                 (item) =>
                                   item.targetId === target.targetId,
                               ) + 1;
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
                           <tr key={target.targetId}>
                             <td className="mission-target-select">
                               <input
                                 type="checkbox"
                                 checked={selected}
                                 disabled={
                                   busy ||
                                   (isDialogueRegistration && !appendable)
                                 }
                                 onChange={() =>
                                   toggleTarget(target.targetId)
                                 }
                                 aria-label={`选择目标物 ${target.targetId}`}
                               />
                             </td>
                             <td>
                               <strong>{target.targetId}</strong>
                               <small>
                                 {target.description || "未填写描述"}
                               </small>
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
                                 {selected &&
                                 selectedBlueprintIndex &&
                                 selectedBlueprintIndex > 0
                                   ? `BP ${selectedBlueprintIndex} · ${label.name}`
                                   : label.name}
                               </code>
                             </td>
                           </tr>
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
        </div>

        <footer>
          <span>
            {isDialogueRegistration
              ? `BP 已有 ${blueprintRegistrationSlots.length} 个固定角色位${
                  plan
                    ? `；待追加 ${selectedAppendTargets.length} / ${selectableTargetRows.length} 个目标物`
                    : ""
                }`
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
                  ? selectedAppendTargets.length > 0
                    ? appendBlueprintTargets()
                    : registerDialogue()
                  : createBlueprint())
              }
              disabled={
                busy ||
                !blueprintName.trim() ||
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
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : selectedAppendTargets.length > 0 ||
                !isDialogueRegistration ? (
                <PackagePlus size={16} />
              ) : (
                <Link2 size={16} />
              )}
              {busy
                ? "正在处理..."
                : isDialogueRegistration
                  ? selectedAppendTargets.length > 0
                    ? "添加到 BP 并注册"
                    : "按 BP 注册到对话"
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
                    ，下列未匹配 Actor 按背景资源审核
                  </span>
                )}
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
              {backgroundPropError && (
                <div className="mission-map-choice__error" role="alert">
                  <AlertTriangle size={15} />
                  <span>{backgroundPropError}</span>
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
                  {selectableBackgroundItems.length} 个可写入 Actor
                </span>
                <div>
                  {backgroundDialogueSetupReasons.length > 0 && (
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
