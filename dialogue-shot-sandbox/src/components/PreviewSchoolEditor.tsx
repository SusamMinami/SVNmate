import {
  AlertTriangle,
  Check,
  ChevronRight,
  LoaderCircle,
  UserRoundSearch,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CareerPreviewOption,
  DialoguePreviewSchoolPreview,
  DialoguePreviewSchoolRequest,
} from "../types";
import {
  applyDialoguePreviewSchool,
  inspectDialoguePreviewSchool,
} from "../ue/client";
import { OverlayScrollArea } from "./OverlayScrollArea";

interface PreviewSchoolEditorProps {
  dialogueNodeId: string;
  careers: CareerPreviewOption[];
  onActivityChange?: (activity: "idle" | "read" | "write") => void;
}

function careerLabel(
  careers: CareerPreviewOption[],
  careerId: number,
): string {
  if (careerId <= 0) {
    return "未配置";
  }
  const career = careers.find((item) => item.id === careerId);
  return career ? `${career.name} · ${career.id}` : `职业 ${careerId}`;
}

export function PreviewSchoolEditor({
  dialogueNodeId,
  careers,
  onActivityChange,
}: PreviewSchoolEditorProps) {
  const operationRunRef = useRef(0);
  const [selectedCareerId, setSelectedCareerId] = useState("");
  const [preview, setPreview] =
    useState<DialoguePreviewSchoolPreview | null>(null);
  const [request, setRequest] =
    useState<DialoguePreviewSchoolRequest | null>(null);
  const [busy, setBusy] = useState<"inspect" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const selectedCareer = useMemo(
    () =>
      careers.find((career) => String(career.id) === selectedCareerId),
    [careers, selectedCareerId],
  );

  useEffect(() => {
    operationRunRef.current += 1;
    setSelectedCareerId("");
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

  async function inspect() {
    if (!selectedCareer) {
      return;
    }
    const operationRun = ++operationRunRef.current;
    const nextRequest: DialoguePreviewSchoolRequest = {
      dialogueId: dialogueNodeId.slice(0, 4),
      startId: dialogueNodeId,
      dialogueNodeId,
      previewSchoolId: selectedCareer.id,
    };
    setBusy("inspect");
    setError("");
    setStatus("");
    try {
      setRequest(nextRequest);
      const nextPreview = await inspectDialoguePreviewSchool(nextRequest);
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
          : "无法检查预览角色配置",
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
      const result = await applyDialoguePreviewSchool(
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
          ? `PreviewSchoolID ${result.previewSchoolId} 已写入并保存`
          : `PreviewSchoolID 已是 ${result.previewSchoolId}`,
      );
    } catch (applyError) {
      if (operationRun !== operationRunRef.current) {
        return;
      }
      setError(
        applyError instanceof Error
          ? applyError.message
          : "预览角色写入失败",
      );
    } finally {
      if (operationRun === operationRunRef.current) {
        setBusy(null);
      }
    }
  }

  return (
    <>
      <section className="inspector-header">
        <div>
          <small>UE CONFIG NODE {dialogueNodeId}</small>
          <h2>预览角色</h2>
        </div>
      </section>

      <OverlayScrollArea className="inspector-tab-panel preview-school-editor">
        <section className="inspector-section">
          <div className="section-label">
            <span>职业配置</span>
            <small>{careers.length} 项</small>
          </div>
          <label className="preview-school-field">
            <span>选择职业</span>
            <select
              aria-label="预览角色"
              value={selectedCareerId}
              disabled={busy !== null || careers.length === 0}
              onChange={(event) => {
                setSelectedCareerId(event.target.value);
                setPreview(null);
                setRequest(null);
                setError("");
                setStatus("");
              }}
            >
              <option value="">请选择职业</option>
              {careers.map((career) => (
                <option value={career.id} key={career.id}>
                  {career.id} · {career.name}
                </option>
              ))}
            </select>
            <small title={selectedCareer?.blueprintPath}>
              {selectedCareer
                ? selectedCareer.blueprintPath || "职业表未填写角色蓝图"
                : "来源：z职业配置表.csv"}
            </small>
          </label>

          <div className="node-camera-command-list">
            <button
              type="button"
              disabled={!selectedCareer || busy !== null}
              onClick={() => void inspect()}
            >
              <UserRoundSearch size={16} />
              <span>
                <strong>预览角色</strong>
                <small>
                  {selectedCareer
                    ? `${selectedCareer.name} · PreviewSchoolID ${selectedCareer.id}`
                    : "选择要在对话预览中使用的职业"}
                </small>
              </span>
              {busy === "inspect" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <ChevronRight size={15} />
              )}
            </button>
          </div>
        </section>

        {careers.length === 0 && (
          <div className="inline-error" role="alert">
            <AlertTriangle size={14} />
            <span>职业配置表没有可用数据，请重新读取 doc 目录。</span>
          </div>
        )}

        {preview && request && (
          <div
            className="node-camera-review preview-school-review"
            aria-label="预览角色写入确认"
          >
            <header>
              <UserRoundSearch size={15} />
              <span>
                <strong>PreviewSchoolID</strong>
                <small>
                  {preview.changed ? "检测到角色变化" : "当前配置已经一致"}
                </small>
              </span>
            </header>
            <dl>
              <div>
                <dt>当前角色</dt>
                <dd>
                  {careerLabel(careers, preview.existingPreviewSchoolId)}
                </dd>
              </div>
              <div>
                <dt>目标角色</dt>
                <dd>
                  {careerLabel(careers, preview.previewSchoolId)}
                </dd>
              </div>
              <div>
                <dt>写入字段</dt>
                <dd>
                  <code>
                    PreviewSchoolID={preview.previewSchoolId}
                  </code>
                </dd>
              </div>
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
                  busy !== null ||
                  !preview.changed ||
                  preview.blockedReasons.length > 0
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
                    : "无需写入"}
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
      </OverlayScrollArea>

      <footer className="inspector-footer">
        <UserRoundSearch size={15} />
        <span>00 配置节点 · z职业配置表.csv</span>
      </footer>
    </>
  );
}
