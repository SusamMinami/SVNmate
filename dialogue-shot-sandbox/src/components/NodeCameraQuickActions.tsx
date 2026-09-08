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
} from "../types";
import {
  applyDialogueCameraQuickAction,
  inspectDialogueCameraQuickAction,
} from "../ue/client";

interface NodeCameraQuickActionsProps {
  dialogueId: string;
  startId: string;
  dialogueNodeId: string;
  previousDialogueNodeId?: string;
  onApplied?: () => void;
}

function actionLabel(mode: DialogueCameraQuickActionMode): string {
  return {
    copy_previous: "使用上一相机参数",
    default: "添加默认镜头",
    blend_curve: "添加镜头曲线",
    school_cameras: "添加角色相机",
  }[mode];
}

export function NodeCameraQuickActions({
  dialogueId,
  startId,
  dialogueNodeId,
  previousDialogueNodeId,
  onApplied,
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

  useEffect(() => {
    operationRunRef.current += 1;
    setPreview(null);
    setRequest(null);
    setBusy(null);
    setError("");
    setStatus("");
  }, [dialogueNodeId]);

  async function inspect(mode: DialogueCameraQuickActionMode) {
    const operationRun = ++operationRunRef.current;
    const nextRequest: DialogueCameraQuickActionRequest = {
      dialogueId,
      startId,
      dialogueNodeId,
      ...(mode === "copy_previous" && previousDialogueNodeId
        ? { previousDialogueNodeId }
        : {}),
      ...(mode === "blend_curve"
        ? { blendCurveAssetName: blendCurveAssetName.trim() }
        : {}),
      mode,
    };
    setBusy("inspect");
    setError("");
    setStatus("");
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
        preview.reviewToken,
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
          disabled={!previousDialogueNodeId || busy !== null}
          title={
            previousDialogueNodeId
              ? `复制节点 ${previousDialogueNodeId} 的 CameraPosition 与 MoveCameras`
              : "当前节点没有上一对话节点"
          }
          onClick={() => void inspect("copy_previous")}
        >
          <Copy size={16} />
          <span>
            <strong>使用上一相机参数</strong>
            <small>
              {previousDialogueNodeId
                ? `复制节点 ${previousDialogueNodeId} 的完整参数`
                : "当前节点没有上一节点"}
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
          type="button"
          disabled={busy !== null}
          title="写入 c1、EPush、速度 1、Blend Out 1、FOV 62"
          onClick={() => void inspect("default")}
        >
          <Camera size={16} />
          <span>
            <strong>添加默认镜头</strong>
            <small>c1 · EPush · 速度 1 · Blend Out 1 · FOV 62</small>
          </span>
          {busy === "inspect" && request?.mode === "default" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <ChevronRight size={15} />
          )}
        </button>
        <button
          type="button"
          disabled={busy !== null || !blendCurveAssetName.trim()}
          title="设置 DialogBlendCameraData 为 EBlend 并写入指定 CurveFloat"
          onClick={() => void inspect("blend_curve")}
        >
          <GitMerge size={16} />
          <span>
            <strong>添加镜头曲线</strong>
            <small>{blendCurveAssetName || "请输入 CurveFloat 资产名"} · EBlend</small>
          </span>
          {busy === "inspect" && request?.mode === "blend_curve" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <ChevronRight size={15} />
          )}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          title="将主 MoveCameras 复制给 Ring、Nino 与 Jodie"
          onClick={() => void inspect("school_cameras")}
        >
          <Users size={16} />
          <span>
            <strong>添加角色相机</strong>
            <small>Ring · Nino · Jodie 共用主镜头参数</small>
          </span>
          {busy === "inspect" &&
          request?.mode === "school_cameras" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <ChevronRight size={15} />
          )}
        </button>
      </div>

      {preview && request && (
        <div className="node-camera-review" aria-label="节点镜头写入确认">
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
            {preview.mode === "school_cameras" && (
              <>
                <div>
                  <dt>主镜头配置</dt>
                  <dd>{preview.existingMoveCount} 项 MoveCameras</dd>
                </div>
                <div>
                  <dt>角色组</dt>
                  <dd>
                    {preview.desiredSchoolCameraKeys
                      .map((key) => key.replace(/^E/, ""))
                      .join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt>角色相机</dt>
                  <dd>
                    {preview.existingSchoolCameraCount} 组
                    <ChevronRight size={12} />
                    {preview.desiredSchoolCameraCount} 组
                  </dd>
                </div>
              </>
            )}
          </dl>
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
                busy !== null || preview.blockedReasons.length > 0
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
