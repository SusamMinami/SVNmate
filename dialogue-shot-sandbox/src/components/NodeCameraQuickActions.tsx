import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GitMerge,
  GripVertical,
  LoaderCircle,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import {
  type DragEvent as ReactDragEvent,
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  DialogueCameraQuickActionMode,
  DialogueCameraQuickActionPreview,
  DialogueCameraQuickActionRequest,
  DialogueCameraPresetSnapshot,
  DialogueSchoolCameraCopy,
  DialogueSchoolCameraRole,
  ExistingDialogueNodeConfiguration,
} from "../types";
import {
  applyDialogueCameraQuickAction,
  inspectDialogueCameraQuickAction,
  readDialogueCameraPresets,
} from "../ue/client";

interface NodeCameraQuickActionsProps {
  dialogueId: string;
  startId: string;
  dialogueNodeId: string;
  previousDialogueNodeIds?: string[];
  existingConfiguration?: ExistingDialogueNodeConfiguration;
  configurationLoading?: boolean;
  externalConfirmation?: boolean;
  reviewHost?: HTMLElement | null;
  onApplied?: () => void;
  onActivityChange?: (activity: "idle" | "read" | "write") => void;
  onSelectionChange?: (
    selection: NodeCameraQuickActionSelection | null,
  ) => void;
}

export interface NodeCameraQuickActionHandle {
  confirm: () => Promise<void>;
  clear: () => void;
}

export interface NodeCameraQuickActionSelection {
  mode: DialogueCameraQuickActionMode;
  label: string;
  ready: boolean;
  changed: boolean;
  blockedReason: string;
  busy: "inspect" | "apply" | null;
}

function ReviewPlacement({
  children,
  external,
  host,
}: {
  children: ReactNode;
  external: boolean;
  host?: HTMLElement | null;
}) {
  if (!external) {
    return children;
  }
  return host ? createPortal(children, host) : null;
}

function actionLabel(mode: DialogueCameraQuickActionMode): string {
  return {
    copy_previous: "使用上一相机参数",
    default: "添加默认镜头",
    preset_camera: "使用预设机位",
    blend_curve: "添加镜头曲线",
    school_cameras: "添加角色相机",
    copy_school_cameras: "复制角色相机",
  }[mode];
}

const SCHOOL_CAMERA_ROLES = [
  { key: "ERing", label: "Ring" },
  { key: "ENino", label: "Nino" },
  { key: "EJodie", label: "Jodie" },
] as const satisfies ReadonlyArray<{
  key: DialogueSchoolCameraRole;
  label: string;
}>;

const SCHOOL_CAMERA_DRAG_TYPE =
  "application/x-shot-sandbox-school-camera";

function schoolCameraRoleLabel(role: DialogueSchoolCameraRole): string {
  return SCHOOL_CAMERA_ROLES.find(({ key }) => key === role)?.label ?? role;
}

function isSchoolCameraRole(value: string): value is DialogueSchoolCameraRole {
  return SCHOOL_CAMERA_ROLES.some(({ key }) => key === value);
}

function assetName(assetPath: string): string {
  return assetPath.split("/").at(-1)?.split(".")[0] ?? assetPath;
}

function schoolCameraConfirmationPreview(
  request: DialogueCameraQuickActionRequest,
  configuration: ExistingDialogueNodeConfiguration,
): DialogueCameraQuickActionPreview {
  const existingKeys = Array.from(new Set(configuration.schoolCameraKeys));
  const missingKeys = SCHOOL_CAMERA_ROLES
    .map(({ key }) => key)
    .filter((key) => !existingKeys.includes(key));
  return {
    reviewToken: "",
    dialogueId: request.dialogueId,
    startId: request.startId,
    dialogueNodeId: request.dialogueNodeId,
    dialogueAssetPath: "",
    mode: "school_cameras",
    sourceDialogueNodeId: null,
    existingCameraPosition: configuration.cameraPosition,
    desiredCameraPosition: configuration.cameraPosition,
    existingMoveCount: configuration.moveCameraCount,
    desiredMoveCount: configuration.moveCameraCount,
    cameraMoveType: configuration.cameraMoveTypes[0] ?? "",
    velocity: null,
    blendOutTime: null,
    fov: configuration.fov,
    existingBlendCameraType: configuration.blendCameraType,
    desiredBlendCameraType: configuration.blendCameraType,
    existingBlendCurve: configuration.blendCurve,
    desiredBlendCurve: configuration.blendCurve,
    blendDuration: configuration.blendDuration,
    existingSchoolCameraKeys: existingKeys,
    addedSchoolCameraKeys: missingKeys,
    desiredSchoolCameraKeys: [...existingKeys, ...missingKeys],
    schoolCameraCopies: [],
    existingSchoolCameraCount: existingKeys.length,
    desiredSchoolCameraCount: existingKeys.length + missingKeys.length,
    changed: missingKeys.length > 0,
    blockedReasons:
      configuration.moveCameraCount > 0
        ? []
        : ["当前节点没有主 MoveCameras，请先添加或沿用一个镜头"],
  };
}

function defaultCameraConfirmationPreview(
  request: DialogueCameraQuickActionRequest,
  configuration: ExistingDialogueNodeConfiguration,
): DialogueCameraQuickActionPreview {
  const existingKeys = Array.from(new Set(configuration.schoolCameraKeys));
  return {
    reviewToken: "",
    dialogueId: request.dialogueId,
    startId: request.startId,
    dialogueNodeId: request.dialogueNodeId,
    dialogueAssetPath: "",
    mode: "default",
    sourceDialogueNodeId: null,
    existingCameraPosition: configuration.cameraPosition,
    desiredCameraPosition: "c1",
    existingMoveCount: configuration.moveCameraCount,
    desiredMoveCount: 1,
    cameraMoveType: "EPush",
    velocity: 1,
    blendOutTime: 1,
    fov: 62,
    existingBlendCameraType: configuration.blendCameraType,
    desiredBlendCameraType: configuration.blendCameraType,
    existingBlendCurve: configuration.blendCurve,
    desiredBlendCurve: configuration.blendCurve,
    blendDuration: configuration.blendDuration,
    existingSchoolCameraKeys: existingKeys,
    addedSchoolCameraKeys: [],
    desiredSchoolCameraKeys: existingKeys,
    schoolCameraCopies: [],
    existingSchoolCameraCount: configuration.schoolCameraCount,
    desiredSchoolCameraCount: configuration.schoolCameraCount,
    changed: true,
    blockedReasons: [],
  };
}

function schoolCameraCopyDraftPreview(
  request: DialogueCameraQuickActionRequest,
  configuration: ExistingDialogueNodeConfiguration,
): DialogueCameraQuickActionPreview {
  const existingKeys = Array.from(new Set(configuration.schoolCameraKeys));
  const copies = request.schoolCameraCopies ?? [];
  const addedKeys = copies
    .map(({ targetRole }) => targetRole)
    .filter((key) => !existingKeys.includes(key));
  const desiredKeys = Array.from(new Set([...existingKeys, ...addedKeys]));
  return {
    reviewToken: "",
    dialogueId: request.dialogueId,
    startId: request.startId,
    dialogueNodeId: request.dialogueNodeId,
    dialogueAssetPath: "",
    mode: "copy_school_cameras",
    sourceDialogueNodeId: null,
    existingCameraPosition: configuration.cameraPosition,
    desiredCameraPosition: configuration.cameraPosition,
    existingMoveCount: configuration.moveCameraCount,
    desiredMoveCount: configuration.moveCameraCount,
    cameraMoveType: configuration.cameraMoveTypes[0] ?? "",
    velocity: null,
    blendOutTime: null,
    fov: configuration.fov,
    existingBlendCameraType: configuration.blendCameraType,
    desiredBlendCameraType: configuration.blendCameraType,
    existingBlendCurve: configuration.blendCurve,
    desiredBlendCurve: configuration.blendCurve,
    blendDuration: configuration.blendDuration,
    existingSchoolCameraKeys: existingKeys,
    addedSchoolCameraKeys: addedKeys,
    desiredSchoolCameraKeys: desiredKeys,
    schoolCameraCopies: copies,
    existingSchoolCameraCount: existingKeys.length,
    desiredSchoolCameraCount: desiredKeys.length,
    changed: copies.length > 0,
    blockedReasons: [],
  };
}

export const NodeCameraQuickActions = forwardRef<
  NodeCameraQuickActionHandle,
  NodeCameraQuickActionsProps
>(function NodeCameraQuickActions({
  dialogueId,
  startId,
  dialogueNodeId,
  previousDialogueNodeIds = [],
  existingConfiguration,
  configurationLoading = false,
  externalConfirmation = false,
  reviewHost,
  onApplied,
  onActivityChange,
  onSelectionChange,
}, ref) {
  const operationRunRef = useRef(0);
  const presetReadRunRef = useRef(0);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presets, setPresets] = useState<DialogueCameraPresetSnapshot | null>(null);
  const [presetLoading, setPresetLoading] = useState(false);
  const [presetError, setPresetError] = useState("");
  const [presetRole, setPresetRole] = useState("");
  const [presetName, setPresetName] = useState("");
  const [preview, setPreview] =
    useState<DialogueCameraQuickActionPreview | null>(null);
  const [request, setRequest] =
    useState<DialogueCameraQuickActionRequest | null>(null);
  const [busy, setBusy] = useState<"inspect" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [blendCurveAssetName, setBlendCurveAssetName] =
    useState("trans_6015");
  const [
    selectedSchoolCameraSource,
    setSelectedSchoolCameraSource,
  ] = useState<DialogueSchoolCameraRole | null>(null);
  const [
    draggedSchoolCameraSource,
    setDraggedSchoolCameraSource,
  ] = useState<DialogueSchoolCameraRole | null>(null);
  const [schoolCameraDropTarget, setSchoolCameraDropTarget] =
    useState<DialogueSchoolCameraRole | null>(null);
  const cameraConfigured = Boolean(
    existingConfiguration?.cameraPosition ||
      existingConfiguration?.moveCameraCount,
  );
  const cameraSummary = configurationLoading
    ? "正在读取当前节点参数..."
    : cameraConfigured
    ? [
        existingConfiguration?.cameraPosition,
        existingConfiguration?.cameraMoveTypes.join(" / "),
        existingConfiguration?.fov !== null &&
        existingConfiguration?.fov !== undefined
          ? `FOV ${existingConfiguration.fov}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : existingConfiguration
      ? "未配置 · 将写入 c1 / EPush / FOV 62"
      : "未读取 · 将写入 c1 / EPush / FOV 62";
  const blendConfigured = Boolean(
    existingConfiguration?.blendCameraType === "EBlend" ||
      existingConfiguration?.blendCurve,
  );
  const blendSummary = configurationLoading
    ? "正在读取当前节点 Blend..."
    : blendConfigured
    ? [
        existingConfiguration?.blendCameraType,
        existingConfiguration?.blendCurve
          ? assetName(existingConfiguration.blendCurve)
          : "",
        existingConfiguration?.blendDuration
          ? `${existingConfiguration.blendDuration}s`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : `${blendCurveAssetName || "请输入 CurveFloat 资产名"} · EBlend`;
  const configuredSchoolCameraKeys = new Set(
    existingConfiguration?.schoolCameraKeys ?? [],
  );
  const allSchoolCamerasConfigured = SCHOOL_CAMERA_ROLES.every(
    ({ key }) => configuredSchoolCameraKeys.has(key),
  );
  const schoolCameraCopies =
    request?.mode === "copy_school_cameras"
      ? request.schoolCameraCopies ?? []
      : [];
  const schoolCameraEditorOpen =
    request?.mode === "school_cameras" ||
    request?.mode === "copy_school_cameras";

  useEffect(() => {
    operationRunRef.current += 1;
    presetReadRunRef.current += 1;
    setPresetOpen(false);
    setPresets(null);
    setPresetRole("");
    setPresetName("");
    setPresetLoading(false);
    setPresetError("");
    setPreview(null);
    setRequest(null);
    setBusy(null);
    setError("");
    setStatus("");
    setSelectedSchoolCameraSource(null);
    setDraggedSchoolCameraSource(null);
    setSchoolCameraDropTarget(null);
  }, [dialogueId, startId, dialogueNodeId]);

  useEffect(() => () => {
    operationRunRef.current += 1;
    presetReadRunRef.current += 1;
  }, []);

  async function loadPresets() {
    const run = ++presetReadRunRef.current;
    setPresetLoading(true);
    setPresetError("");
    setPresets(null);
    setPresetRole("");
    setPresetName("");
    if (request?.mode === "preset_camera") {
      operationRunRef.current += 1;
      setPreview(null);
      setBusy(null);
    }
    try {
      const snapshot = await readDialogueCameraPresets({ dialogueId, startId, dialogueNodeId });
      if (run === presetReadRunRef.current) setPresets(snapshot);
    } catch (reason) {
      if (run === presetReadRunRef.current) {
        setPresetError(reason instanceof Error ? reason.message : "无法读取角色预设");
      }
    } finally {
      if (run === presetReadRunRef.current) setPresetLoading(false);
    }
  }

  async function selectPreset(cameraName: string) {
    const role = presets?.roles.find((item) => String(item.modelIndex) === presetRole);
    const camera = role?.cameras.find((item) => item.name === cameraName);
    if (!presets || !role || !camera) return;
    const run = ++operationRunRef.current;
    const nextRequest: DialogueCameraQuickActionRequest = {
      dialogueId, startId, dialogueNodeId, mode: "preset_camera",
      presetCamera: { modelIndex: role.modelIndex, cameraName, fingerprint: presets.fingerprint },
    };
    setPresetName(cameraName);
    setRequest(nextRequest);
    setPreview(null);
    setBusy("inspect");
    setError("");
    setStatus("");
    try {
      const nextPreview = await inspectDialogueCameraQuickAction(nextRequest);
      if (run === operationRunRef.current) setPreview(nextPreview);
    } catch (reason) {
      if (run === operationRunRef.current) setError(reason instanceof Error ? reason.message : "无法检查预设机位");
    } finally {
      if (run === operationRunRef.current) setBusy(null);
    }
  }

  useEffect(() => {
    if (!request) {
      onSelectionChange?.(null);
      return;
    }
    onSelectionChange?.({
      mode: request.mode,
      label: actionLabel(request.mode),
      ready: Boolean(preview),
      changed: preview?.changed ?? false,
      blockedReason: preview?.blockedReasons[0] ?? "",
      busy,
    });
  }, [busy, onSelectionChange, preview, request]);

  useEffect(() => {
    onActivityChange?.(
      busy === "apply" ? "write" : busy === "inspect" ? "read" : "idle",
    );
  }, [busy, onActivityChange]);

  useEffect(
    () => () => {
      onActivityChange?.("idle");
      onSelectionChange?.(null);
    },
    [onActivityChange, onSelectionChange],
  );

  async function inspect(mode: DialogueCameraQuickActionMode) {
    const operationRun = ++operationRunRef.current;
    setPreview(null);
    if (mode !== "default") {
      setPresetOpen(false);
      presetReadRunRef.current += 1;
      setPresetLoading(false);
    }
    const nextRequest: DialogueCameraQuickActionRequest = {
      dialogueId,
      startId,
      dialogueNodeId,
      ...(mode === "copy_previous" && previousDialogueNodeIds.length > 0
        ? { previousDialogueNodeIds }
        : {}),
      ...(mode === "blend_curve"
        ? { blendCurveAssetName: blendCurveAssetName.trim() }
        : {}),
      mode,
    };
    setError("");
    setStatus("");
    setSelectedSchoolCameraSource(null);
    setDraggedSchoolCameraSource(null);
    setSchoolCameraDropTarget(null);
    if (mode === "school_cameras" && existingConfiguration) {
      setRequest(nextRequest);
      setPreview(
        schoolCameraConfirmationPreview(nextRequest, existingConfiguration),
      );
      return;
    }
    if (mode === "default" && existingConfiguration) {
      setRequest(nextRequest);
      setPreview(
        defaultCameraConfirmationPreview(nextRequest, existingConfiguration),
      );
      return;
    }
    setBusy("inspect");
    try {
      setRequest(nextRequest);
      const nextPreview =
        await inspectDialogueCameraQuickAction(nextRequest);
      if (operationRun === operationRunRef.current) {
        setPreview(nextPreview);
      }
    } catch (inspectError) {
      if (operationRun !== operationRunRef.current) {
        return;
      }
      setPreview(null);
      setRequest(null);
      setError(
        inspectError instanceof Error
          ? inspectError.message
          : "无法检查节点相机数据",
      );
    } finally {
      if (operationRun === operationRunRef.current) {
        setBusy(null);
      }
    }
  }

  async function inspectSchoolCameraCopies(
    copies: DialogueSchoolCameraCopy[],
  ) {
    if (!existingConfiguration || copies.length === 0) {
      return;
    }
    const operationRun = ++operationRunRef.current;
    const nextRequest: DialogueCameraQuickActionRequest = {
      dialogueId,
      startId,
      dialogueNodeId,
      mode: "copy_school_cameras",
      schoolCameraCopies: copies,
    };
    const draftPreview = schoolCameraCopyDraftPreview(
      nextRequest,
      existingConfiguration,
    );
    setRequest(nextRequest);
    setPreview(draftPreview);
    setBusy("inspect");
    setError("");
    setStatus("");
    try {
      const nextPreview =
        await inspectDialogueCameraQuickAction(nextRequest);
      if (operationRun === operationRunRef.current) {
        setPreview(nextPreview);
      }
    } catch (inspectError) {
      if (operationRun !== operationRunRef.current) {
        return;
      }
      const message =
        inspectError instanceof Error
          ? inspectError.message
          : "无法检查角色相机复制";
      setPreview({
        ...draftPreview,
        changed: false,
        blockedReasons: [message],
      });
    } finally {
      if (operationRun === operationRunRef.current) {
        setBusy(null);
      }
    }
  }

  function stageSchoolCameraCopy(
    sourceRole: DialogueSchoolCameraRole,
    targetRole: DialogueSchoolCameraRole,
  ) {
    if (
      busy !== null ||
      sourceRole === targetRole ||
      !configuredSchoolCameraKeys.has(sourceRole)
    ) {
      return;
    }
    const copyByTarget = new Map(
      schoolCameraCopies.map((copy) => [copy.targetRole, copy]),
    );
    copyByTarget.set(targetRole, { sourceRole, targetRole });
    const nextCopies = SCHOOL_CAMERA_ROLES.flatMap(({ key }) => {
      const copy = copyByTarget.get(key);
      return copy ? [copy] : [];
    });
    setSelectedSchoolCameraSource(null);
    setDraggedSchoolCameraSource(null);
    setSchoolCameraDropTarget(null);
    void inspectSchoolCameraCopies(nextCopies);
  }

  function removeSchoolCameraCopy(targetRole: DialogueSchoolCameraRole) {
    if (!existingConfiguration || busy !== null) {
      return;
    }
    const nextCopies = schoolCameraCopies.filter(
      (copy) => copy.targetRole !== targetRole,
    );
    setSelectedSchoolCameraSource(null);
    setDraggedSchoolCameraSource(null);
    setSchoolCameraDropTarget(null);
    if (nextCopies.length > 0) {
      void inspectSchoolCameraCopies(nextCopies);
      return;
    }
    operationRunRef.current += 1;
    const nextRequest: DialogueCameraQuickActionRequest = {
      dialogueId,
      startId,
      dialogueNodeId,
      mode: "school_cameras",
    };
    setRequest(nextRequest);
    setPreview(
      schoolCameraConfirmationPreview(nextRequest, existingConfiguration),
    );
    setBusy(null);
    setError("");
  }

  function schoolCameraDragStart(
    event: ReactDragEvent<HTMLButtonElement>,
    sourceRole: DialogueSchoolCameraRole,
  ) {
    if (busy !== null || !configuredSchoolCameraKeys.has(sourceRole)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(SCHOOL_CAMERA_DRAG_TYPE, sourceRole);
    setDraggedSchoolCameraSource(sourceRole);
    setSchoolCameraDropTarget(null);
  }

  function schoolCameraDrop(
    event: ReactDragEvent<HTMLDivElement>,
    targetRole: DialogueSchoolCameraRole,
  ) {
    event.preventDefault();
    const sourceRole = event.dataTransfer.getData(
      SCHOOL_CAMERA_DRAG_TYPE,
    );
    setDraggedSchoolCameraSource(null);
    setSchoolCameraDropTarget(null);
    if (isSchoolCameraRole(sourceRole)) {
      stageSchoolCameraCopy(sourceRole, targetRole);
    }
  }

  async function apply() {
    if (!preview || !request || busy || preview.blockedReasons.length > 0) {
      return;
    }
    const operationRun = ++operationRunRef.current;
    setBusy("apply");
    setError("");
    setStatus("");
    try {
      const result = await applyDialogueCameraQuickAction(
        request,
        preview.reviewToken || undefined,
      );
      if (operationRun !== operationRunRef.current) {
        return;
      }
      setPreview(null);
      setRequest(null);
      setPresetOpen(false);
      presetReadRunRef.current += 1;
      setPresetLoading(false);
      setSelectedSchoolCameraSource(null);
      setDraggedSchoolCameraSource(null);
      setSchoolCameraDropTarget(null);
      setStatus(
        result.status === "updated"
          ? `节点 ${result.dialogueNodeId} 的镜头配置已写入并保存`
          : `节点 ${result.dialogueNodeId} 已是目标配置`,
      );
      onApplied?.();
    } catch (applyError) {
      if (operationRun !== operationRunRef.current) {
        return;
      }
      setError(
        applyError instanceof Error
          ? applyError.message
          : "节点镜头写入失败",
      );
    } finally {
      if (operationRun === operationRunRef.current) {
        setBusy(null);
      }
    }
  }

  function clear() {
    operationRunRef.current += 1;
    presetReadRunRef.current += 1;
    setPresetOpen(false);
    setPresetLoading(false);
    setPreview(null);
    setRequest(null);
    setBusy(null);
    setError("");
    setSelectedSchoolCameraSource(null);
    setDraggedSchoolCameraSource(null);
    setSchoolCameraDropTarget(null);
  }

  useImperativeHandle(ref, () => ({
    confirm: apply,
    clear,
  }));

  return (
    <section className="inspector-section node-camera-quick-actions">
      <div className="section-label">
        <span>镜头快捷操作</span>
        <small>节点 {dialogueNodeId}</small>
      </div>

      <label className="node-camera-curve-field">
        <span>混合曲线资产</span>
        <input
          aria-label="镜头混合曲线资产名"
          value={blendCurveAssetName}
          disabled={busy !== null}
          maxLength={128}
          onChange={(event) => {
            setBlendCurveAssetName(event.target.value);
            if (request?.mode === "blend_curve") {
              clear();
            }
          }}
        />
      </label>

      <div className="node-camera-command-list">
        <button
          className={
            request?.mode === "copy_previous" ? "is-selected" : undefined
          }
          type="button"
          disabled={previousDialogueNodeIds.length === 0 || busy !== null}
          title={
            previousDialogueNodeIds.length > 0
              ? "向前查找最近一个已配置节点，复制其 CameraPosition 与 MoveCameras"
              : "当前节点之前没有对话节点"
          }
          onClick={() => void inspect("copy_previous")}
        >
          <Copy size={16} />
          <span>
            <strong>使用上一相机参数</strong>
            <small>
              {previousDialogueNodeIds.length > 0
                ? "自动查找最近的已配置节点"
                : "当前节点之前没有节点"}
            </small>
          </span>
          {busy === "inspect" &&
          request?.mode === "copy_previous" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <ChevronRight size={15} />
          )}
        </button>
        <button
          className={[
            cameraConfigured ? "is-configured" : "",
            presetOpen ? "is-selected" : "",
          ].filter(Boolean).join(" ")}
          type="button"
          aria-expanded={presetOpen}
          aria-controls={`camera-preset-picker-${dialogueNodeId}`}
          disabled={
            busy !== null || configurationLoading || !existingConfiguration
          }
          title={
            configurationLoading || !existingConfiguration
              ? "等待读取当前节点镜头配置"
              : "确认后写入 c1、EPush、速度 1、Blend Out 1、FOV 62"
          }
          onClick={() => {
            if (presetOpen) {
              clear();
              return;
            }
            setPresetOpen(true);
            void inspect("default");
            void loadPresets();
          }}
        >
          <Camera size={16} />
          <span>
            <strong>添加默认镜头</strong>
            <small>{cameraSummary}</small>
          </span>
          {presetOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        {presetOpen && (
          <div className="node-camera-preset-picker" id={`camera-preset-picker-${dialogueNodeId}`}>
            <div className="node-camera-preset-picker__fields">
              <label>
                <span>角色</span>
                <select
                  aria-label="预设机位角色"
                  value={presetRole}
                  disabled={presetLoading || busy !== null || !presets?.roles.length}
                  onChange={(event) => {
                    setPresetRole(event.target.value);
                    setPresetName("");
                    setError("");
                    operationRunRef.current += 1;
                    if (!event.target.value) {
                      void inspect("default");
                    } else {
                      setRequest({ dialogueId, startId, dialogueNodeId, mode: "preset_camera" });
                      setPreview(null);
                    }
                  }}
                >
                  <option value="">默认位置</option>
                  {presets?.roles.map((role) => (
                    <option key={role.modelIndex} value={role.modelIndex}>
                      {role.modelIndex} · {role.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>预设角度</span>
                <select
                  aria-label="预设机位角度"
                  value={presetName}
                  disabled={!presetRole || presetLoading || busy !== null}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value) void selectPreset(value);
                    else {
                      setPresetName("");
                      setPreview(null);
                    }
                  }}
                >
                  <option value="">选择机位</option>
                  {presets?.roles.find((role) => String(role.modelIndex) === presetRole)?.cameras.map((camera) => (
                    <option key={camera.name} value={camera.name}>{camera.label}</option>
                  ))}
                </select>
              </label>
              <button
                className="icon-button"
                type="button"
                aria-label="重新读取预设机位"
                title="重新读取当前 UE 预览机位"
                disabled={presetLoading || busy !== null}
                onClick={() => void loadPresets()}
              >
                {presetLoading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              </button>
            </div>
            {presetLoading && <p role="status">正在读取预览角色机位...</p>}
            {presetError && <p role="alert" className="node-camera-review__warning">{presetError}</p>}
          </div>
        )}
        <button
          className={[
            blendConfigured ? "is-configured" : "",
            request?.mode === "blend_curve" ? "is-selected" : "",
          ].filter(Boolean).join(" ")}
          type="button"
          disabled={busy !== null || !blendCurveAssetName.trim()}
          title="设置 DialogBlendCameraData 为 EBlend 并写入指定 CurveFloat"
          onClick={() => void inspect("blend_curve")}
        >
          <GitMerge size={16} />
          <span>
            <strong>添加镜头曲线</strong>
            <small>{blendSummary}</small>
          </span>
          {busy === "inspect" && request?.mode === "blend_curve" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <ChevronRight size={15} />
          )}
        </button>
        <button
          className={
            [
              allSchoolCamerasConfigured ? "is-configured" : "",
              schoolCameraEditorOpen ? "is-selected" : "",
            ].filter(Boolean).join(" ") || undefined
          }
          type="button"
          aria-expanded={schoolCameraEditorOpen}
          aria-controls={`school-camera-editor-${dialogueNodeId}`}
          disabled={
            busy !== null || configurationLoading || !existingConfiguration
          }
          title={
            configurationLoading || !existingConfiguration
              ? "等待读取当前节点镜头配置"
              : "补齐缺失角色相机，或展开后复制已有角色相机参数"
          }
          onClick={() => void inspect("school_cameras")}
        >
          <Users size={16} />
          <span>
            <strong>添加角色相机</strong>
            <small className="node-camera-role-list">
              {SCHOOL_CAMERA_ROLES.map(({ key, label }) => (
                <span
                  className={
                    configuredSchoolCameraKeys.has(key)
                      ? "is-configured"
                      : undefined
                  }
                  key={key}
                >
                  {label}
                </span>
              ))}
            </small>
          </span>
          {schoolCameraEditorOpen ? (
            <ChevronDown size={15} />
          ) : (
            <ChevronRight size={15} />
          )}
        </button>
      </div>

      {preview && request && (
        <ReviewPlacement
          external={externalConfirmation}
          host={reviewHost}
        >
          <div
            className={`node-camera-review ${
              preview.mode === "school_cameras" ||
              preview.mode === "copy_school_cameras"
                ? "node-camera-review--confirmation"
                : ""
            }`}
            aria-label="节点镜头写入确认"
          >
            <button
              className="icon-button node-camera-review__clear"
              type="button"
              title="取消当前镜头方案"
              aria-label="取消当前镜头方案"
              disabled={busy !== null}
              onClick={clear}
            >
              <X size={13} />
            </button>
            {preview.mode === "school_cameras" ||
            preview.mode === "copy_school_cameras" ? (
              <div
                className={[
                  "node-camera-review__school-editor",
                  schoolCameraCopies.length > 0 ? "has-overwrite" : "",
                ].filter(Boolean).join(" ")}
                id={`school-camera-editor-${dialogueNodeId}`}
              >
                <div className="node-camera-review__confirmation">
                  <Users size={16} />
                  <span>
                    <strong>
                      {schoolCameraCopies.length > 0
                        ? "确认角色相机覆盖"
                        : preview.changed
                          ? "确认补齐角色相机"
                          : "角色相机已完整配置"}
                    </strong>
                    <small>
                      {schoolCameraCopies.length > 0
                        ? schoolCameraCopies
                            .map(
                              ({ sourceRole, targetRole }) =>
                                `${schoolCameraRoleLabel(sourceRole)} → ${schoolCameraRoleLabel(targetRole)}`,
                            )
                            .join(" · ")
                        : preview.addedSchoolCameraKeys.length > 0
                          ? `${preview.addedSchoolCameraKeys.length} 项将从主镜头补齐`
                          : `${preview.existingSchoolCameraCount} 项已配置`}
                    </small>
                  </span>
                </div>
                <div
                  className="school-camera-copy-grid"
                  role="group"
                  aria-label="角色相机复制映射"
                >
                  {SCHOOL_CAMERA_ROLES.map(({ key, label }) => {
                    const configured =
                      configuredSchoolCameraKeys.has(key);
                    const stagedCopy = schoolCameraCopies.find(
                      (copy) => copy.targetRole === key,
                    );
                    const activeSource =
                      draggedSchoolCameraSource ??
                      selectedSchoolCameraSource;
                    const canReceive =
                      activeSource !== null && activeSource !== key;
                    return (
                      <div
                        className={[
                          "school-camera-role-card",
                          configured ? "is-configured" : "",
                          stagedCopy ? "has-copy" : "",
                          selectedSchoolCameraSource === key
                            ? "is-source"
                            : "",
                          draggedSchoolCameraSource === key
                            ? "is-dragging"
                            : "",
                          schoolCameraDropTarget === key && canReceive
                            ? "is-drop-target"
                            : "",
                        ].filter(Boolean).join(" ")}
                        data-school-camera-role={key}
                        key={key}
                        onDragEnter={(event) => {
                          if (canReceive) {
                            event.preventDefault();
                            setSchoolCameraDropTarget(key);
                          }
                        }}
                        onDragOver={(event) => {
                          if (canReceive) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "copy";
                            setSchoolCameraDropTarget(key);
                          }
                        }}
                        onDragLeave={() => {
                          if (schoolCameraDropTarget === key) {
                            setSchoolCameraDropTarget(null);
                          }
                        }}
                        onDrop={(event) =>
                          schoolCameraDrop(event, key)
                        }
                      >
                        <button
                          className="school-camera-role-card__source"
                          type="button"
                          draggable={configured && busy === null}
                          disabled={busy !== null}
                          aria-pressed={
                            selectedSchoolCameraSource === key
                          }
                          aria-label={
                            configured
                              ? `${label} 角色相机，选择为复制来源`
                              : `${label} 角色相机未配置，可作为覆盖目标`
                          }
                          title={
                            configured
                              ? `拖动 ${label} 到目标角色，或先选择再选择目标`
                              : activeSource
                                ? `使用 ${schoolCameraRoleLabel(activeSource)} 覆盖 ${label}`
                                : `${label} 尚未配置角色相机`
                          }
                          onClick={() => {
                            if (
                              selectedSchoolCameraSource &&
                              selectedSchoolCameraSource !== key
                            ) {
                              stageSchoolCameraCopy(
                                selectedSchoolCameraSource,
                                key,
                              );
                              return;
                            }
                            if (configured) {
                              setSelectedSchoolCameraSource(
                                selectedSchoolCameraSource === key
                                  ? null
                                  : key,
                              );
                            }
                          }}
                          onDragStart={(event) =>
                            schoolCameraDragStart(event, key)
                          }
                          onDragEnd={() => {
                            setDraggedSchoolCameraSource(null);
                            setSchoolCameraDropTarget(null);
                          }}
                        >
                          <GripVertical size={13} />
                          <span>
                            <strong>{label}</strong>
                            <small>
                              {stagedCopy
                                ? `${schoolCameraRoleLabel(stagedCopy.sourceRole)} → ${label}`
                                : configured
                                  ? "已配置"
                                  : "未配置"}
                            </small>
                          </span>
                        </button>
                        {stagedCopy && (
                          <button
                            className="icon-button school-camera-role-card__clear"
                            type="button"
                            title={`取消覆盖 ${label}`}
                            aria-label={`取消覆盖 ${label}`}
                            disabled={busy !== null}
                            onClick={() =>
                              removeSchoolCameraCopy(key)
                            }
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                <header>
                  <Camera size={15} />
                  <span>
                    <strong>{actionLabel(preview.mode)}</strong>
                    <small>
                      {preview.changed
                        ? "检测到参数变化"
                        : "当前参数已经一致"}
                    </small>
                  </span>
                </header>
                <dl>
                  <div>
                    <dt>来源</dt>
                    <dd>
                      {preview.sourceDialogueNodeId
                        ? `节点 ${preview.sourceDialogueNodeId}`
                        : preview.presetCamera
                          ? `${preview.presetCamera.roleLabel} · 机位 ${preview.presetCamera.cameraName}`
                        : preview.mode === "default"
                          ? "全新默认参数"
                          : "当前节点"}
                    </dd>
                  </div>
                  {(preview.mode === "copy_previous" ||
                    preview.mode === "default" || preview.mode === "preset_camera") && (
                    <>
                      <div>
                        <dt>Camera Position</dt>
                        <dd>
                          <code>
                            {preview.existingCameraPosition || "空"}
                          </code>
                          <ChevronRight size={12} />
                          <code>
                            {preview.desiredCameraPosition || "空"}
                          </code>
                        </dd>
                      </div>
                      <div>
                        <dt>Camera Config</dt>
                        <dd>
                          {preview.existingMoveCount} 项
                          <ChevronRight size={12} />
                          {preview.desiredMoveCount} 项
                        </dd>
                      </div>
                      <div>
                        <dt>目标参数</dt>
                        <dd>
                          {preview.cameraMoveType || "-"} · 速度{" "}
                          {preview.velocity ?? "-"} · Blend Out{" "}
                          {preview.blendOutTime ?? "-"} · FOV{" "}
                          {preview.fov ?? "-"}
                        </dd>
                      </div>
                    </>
                  )}
                  {preview.presetCamera && (
                    <>
                      <div>
                        <dt>{preview.presetCamera.relative ? "局部坐标" : "世界坐标"}</dt>
                        <dd><code>{Object.values(preview.presetCamera.pose.position).map((value) => value.toFixed(1)).join(" / ")} cm</code></dd>
                      </div>
                      <div>
                        <dt>旋转 P / Y / R</dt>
                        <dd><code>{Object.values(preview.presetCamera.pose.rotation).map((value) => value.toFixed(1)).join(" / ")}°</code></dd>
                      </div>
                      {preview.existingSchoolCameraCount > 0 && (
                        <div><dt>职业覆盖</dt><dd>保留 {preview.existingSchoolCameraCount} 项，可能覆盖主镜头</dd></div>
                      )}
                    </>
                  )}
                  {preview.mode === "blend_curve" && (
                    <>
                      <div>
                        <dt>Blend Type</dt>
                        <dd>
                          <code>
                            {preview.existingBlendCameraType || "-"}
                          </code>
                          <ChevronRight size={12} />
                          <code>{preview.desiredBlendCameraType}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Blend Curve</dt>
                        <dd>
                          <code>{preview.desiredBlendCurve}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>{preview.blendDuration}s · 保留当前值</dd>
                      </div>
                    </>
                  )}
                </dl>
              </>
            )}
            {preview.blockedReasons.map((reason) => (
              <p className="node-camera-review__warning" key={reason}>
                <AlertTriangle size={13} />
                <span>{reason}</span>
              </p>
            ))}
            {!externalConfirmation && (
              <footer>
                <button
                  className="button"
                  type="button"
                  disabled={busy !== null}
                  onClick={clear}
                >
                  <X size={14} />
                  取消
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={
                    busy !== null ||
                    preview.blockedReasons.length > 0 ||
                    ((preview.mode === "school_cameras" ||
                      preview.mode === "copy_school_cameras") &&
                      !preview.changed)
                  }
                  onClick={() => void apply()}
                >
                  {busy === "apply" ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Check size={14} />
                  )}
                  {busy === "apply"
                    ? "正在写入"
                    : preview.changed
                      ? "确认写入"
                      : "确认无改动"}
                </button>
              </footer>
            )}
          </div>
        </ReviewPlacement>
      )}

      {error && (
        <div className="inline-error" role="alert">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}
      {status && (
        <div className="node-camera-quick-actions__status" role="status">
          <Check size={14} />
          <span>{status}</span>
        </div>
      )}
    </section>
  );
});
