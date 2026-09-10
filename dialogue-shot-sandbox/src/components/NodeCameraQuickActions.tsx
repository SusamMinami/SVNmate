import {
  AlertTriangle,
  Camera,
  Check,
  ChevronRight,
  Copy,
  GitMerge,
  LoaderCircle,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  DialogueCameraQuickActionMode,
  DialogueCameraQuickActionPreview,
  DialogueCameraQuickActionRequest,
  ExistingDialogueNodeConfiguration,
} from "../types";
import {
  applyDialogueCameraQuickAction,
  inspectDialogueCameraQuickAction,
} from "../ue/client";

interface NodeCameraQuickActionsProps {
  dialogueId: string;
  startId: string;
  dialogueNodeId: string;
  previousDialogueNodeIds?: string[];
  existingConfiguration?: ExistingDialogueNodeConfiguration;
  configurationLoading?: boolean;
  onApplied?: () => void;
  onActivityChange?: (activity: "idle" | "read" | "write") => void;
}

function actionLabel(mode: DialogueCameraQuickActionMode): string {
  return {
    copy_previous: "使用上一相机参数",
    default: "添加默认镜头",
    blend_curve: "添加镜头曲线",
    school_cameras: "添加角色相机",
  }[mode];
}

const SCHOOL_CAMERA_ROLES = [
  { key: "ERing", label: "Ring" },
  { key: "ENino", label: "Nino" },
  { key: "EJodie", label: "Jodie" },
] as const;

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
    existingSchoolCameraCount: configuration.schoolCameraCount,
    desiredSchoolCameraCount: configuration.schoolCameraCount,
    changed: true,
    blockedReasons: [],
  };
}

export function NodeCameraQuickActions({
  dialogueId,
  startId,
  dialogueNodeId,
  previousDialogueNodeIds = [],
  existingConfiguration,
  configurationLoading = false,
  onApplied,
  onActivityChange,
}: NodeCameraQuickActionsProps) {
  const operationRunRef = useRef(0);
  const [preview, setPreview] =
    useState<DialogueCameraQuickActionPreview | null>(null);
  const [request, setRequest] =
    useState<DialogueCameraQuickActionRequest | null>(null);
  const [busy, setBusy] = useState<"inspect" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [blendCurveAssetName, setBlendCurveAssetName] =
    useState("trans_6015");
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

  useEffect(() => {
    operationRunRef.current += 1;
    setPreview(null);
    setRequest(null);
    setBusy(null);
    setError("");
    setStatus("");
  }, [dialogueNodeId]);

  useEffect(() => {
    onActivityChange?.(
      busy === "apply" ? "write" : busy === "inspect" ? "read" : "idle",
    );
  }, [busy, onActivityChange]);

  useEffect(
    () => () => {
      onActivityChange?.("idle");
    },
    [onActivityChange],
  );

  async function inspect(mode: DialogueCameraQuickActionMode) {
    const operationRun = ++operationRunRef.current;
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

  async function apply() {
    if (!preview || !request) {
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
          onChange={(event) =>
            setBlendCurveAssetName(event.target.value)
          }
        />
      </label>

      <div className="node-camera-command-list">
        <button
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
          className={cameraConfigured ? "is-configured" : undefined}
          type="button"
          disabled={
            busy !== null || configurationLoading || !existingConfiguration
          }
          title={
            configurationLoading || !existingConfiguration
              ? "等待读取当前节点镜头配置"
              : "确认后写入 c1、EPush、速度 1、Blend Out 1、FOV 62"
          }
          onClick={() => void inspect("default")}
        >
          <Camera size={16} />
          <span>
            <strong>添加默认镜头</strong>
            <small>{cameraSummary}</small>
          </span>
          <ChevronRight size={15} />
        </button>
        <button
          className={blendConfigured ? "is-configured" : undefined}
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
            allSchoolCamerasConfigured ? "is-configured" : undefined
          }
          type="button"
          disabled={
            busy !== null || configurationLoading || !existingConfiguration
          }
          title={
            configurationLoading || !existingConfiguration
              ? "等待读取当前节点镜头配置"
              : "保留已有角色相机，只用主 MoveCameras 补齐缺失项"
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
          <ChevronRight size={15} />
        </button>
      </div>

      {preview && request && (
        <div
          className={`node-camera-review ${
            preview.mode === "school_cameras"
              ? "node-camera-review--confirmation"
              : ""
          }`}
          aria-label="节点镜头写入确认"
        >
          {preview.mode === "school_cameras" ? (
            <div className="node-camera-review__confirmation">
              <Users size={16} />
              <strong>
                {preview.changed
                  ? "确认写入角色相机？"
                  : "角色相机已完整配置"}
              </strong>
            </div>
          ) : (
            <>
              <header>
                <Camera size={15} />
                <span>
                  <strong>{actionLabel(preview.mode)}</strong>
                  <small>
                    {preview.changed ? "检测到参数变化" : "当前参数已经一致"}
                  </small>
                </span>
              </header>
              <dl>
            <div>
              <dt>来源</dt>
              <dd>
                {preview.sourceDialogueNodeId
                  ? `节点 ${preview.sourceDialogueNodeId}`
                  : preview.mode === "default"
                    ? "全新默认参数"
                    : "当前节点"}
              </dd>
            </div>
            {(preview.mode === "copy_previous" ||
              preview.mode === "default") && (
              <>
                <div>
                  <dt>Camera Position</dt>
                  <dd>
                    <code>{preview.existingCameraPosition || "空"}</code>
                    <ChevronRight size={12} />
                    <code>{preview.desiredCameraPosition || "空"}</code>
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
            {preview.mode === "blend_curve" && (
              <>
                <div>
                  <dt>Blend Type</dt>
                  <dd>
                    <code>{preview.existingBlendCameraType || "-"}</code>
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
          <footer>
            <button
              className="button"
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setPreview(null);
                setRequest(null);
              }}
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
                (preview.mode === "school_cameras" && !preview.changed)
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
        </div>
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
}
