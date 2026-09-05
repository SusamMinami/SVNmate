import {
  AlertTriangle,
  CheckCircle2,
  Database,
  LoaderCircle,
  Save,
  X,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type {
  DialogNpcTableRegistrationDraft,
  DialogNpcTableRegistrationReview,
} from "../types";

type EditableDialogNpcRow = Pick<
  DialogNpcTableRegistrationDraft,
  | "rowName"
  | "characterClassPath"
  | "animClassPath"
  | "cameraClassPath"
  | "meshPath"
>;

interface DialogNpcRegistrationModalProps {
  review: DialogNpcTableRegistrationReview;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (rows: EditableDialogNpcRow[]) => void;
}

function assetName(path: string): string {
  const leaf = path.split("/").at(-1) ?? path;
  return leaf.split(".")[0] || leaf;
}

function cameraSuggestionLabel(
  source: DialogNpcTableRegistrationDraft["cameraSuggestionSource"],
): string {
  if (source === "matching_mesh_and_anim") {
    return "按 Mesh + Anim 自动匹配";
  }
  if (source === "matching_mesh") {
    return "按 Mesh 自动匹配";
  }
  if (source === "matching_anim") {
    return "按 Anim 自动匹配";
  }
  return "需要选择";
}

export function DialogNpcRegistrationModal({
  review,
  busy,
  error,
  onClose,
  onSubmit,
}: DialogNpcRegistrationModalProps) {
  const [rows, setRows] = useState<EditableDialogNpcRow[]>(() =>
    review.rows.map((row) => ({
      rowName: row.rowName,
      characterClassPath: row.characterClassPath,
      animClassPath: row.animClassPath,
      cameraClassPath: row.cameraClassPath,
      meshPath: row.meshPath,
    })),
  );
  const validationMessages = useMemo(() => {
    const messages = new Map<number, string[]>();
    const names = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const current: string[] = [];
      if (!/^[A-Za-z0-9_]+$/.test(row.rowName)) {
        current.push("行名只能包含英文、数字和下划线");
      }
      if (!row.cameraClassPath) {
        current.push("请选择 Camera BP");
      }
      if (review.rows[index]?.blockedReasons.length) {
        current.push(
          ...review.rows[index].blockedReasons.filter((reason) => {
            if (
              reason.startsWith("行名 ") &&
              row.rowName !== review.rows[index].rowName
            ) {
              return false;
            }
            if (
              reason === "无法从 BP 名生成有效行名" &&
              /^[A-Za-z0-9_]+$/.test(row.rowName)
            ) {
              return false;
            }
            return true;
          }),
        );
      }
      messages.set(index, current);
      const key = row.rowName.toLowerCase();
      names.set(key, [...(names.get(key) ?? []), index]);
    });
    for (const indexes of names.values()) {
      if (indexes.length < 2) {
        continue;
      }
      for (const index of indexes) {
        messages.get(index)?.push("本批次存在重复行名");
      }
    }
    return messages;
  }, [review.rows, rows]);
  const invalidCount = Array.from(validationMessages.values()).filter(
    (messages) => messages.length > 0,
  ).length;

  function updateRow(
    index: number,
    patch: Partial<Pick<EditableDialogNpcRow, "rowName" | "cameraClassPath">>,
  ) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || invalidCount > 0) {
      return;
    }
    onSubmit(rows);
  }

  return (
    <div className="mission-map-choice-layer" role="presentation">
      <form
        className="mission-map-choice dialog-npc-registration-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-npc-registration-title"
        onSubmit={submit}
      >
        <header>
          <div>
            <Database size={18} />
            <span>
              <strong id="dialog-npc-registration-title">
                补登记 DialogNPCTable
              </strong>
              <small>{review.rows.length} 个未登记 Character BP</small>
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            title="关闭"
            aria-label="关闭 DialogNPCTable 登记"
          >
            <X size={16} />
          </button>
        </header>

        <div className="dialog-npc-registration-notice">
          <AlertTriangle size={15} />
          <span>
            确认后将直接保存 UE 资产。Character、Anim 与 Mesh 来自 BP
            默认对象；Camera BP 需要逐项确认。
          </span>
        </div>

        <div className="dialog-npc-registration-table-wrap">
          <table className="dialog-npc-registration-table">
            <thead>
              <tr>
                <th>槽位</th>
                <th>行名</th>
                <th>Character BP</th>
                <th>Anim / Mesh</th>
                <th>Camera BP</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const draft = review.rows[index];
                const messages = validationMessages.get(index) ?? [];
                return (
                  <tr key={row.characterClassPath}>
                    <td>
                      <code>{draft.modelIndexes.join("、")}</code>
                      {draft.targetIds.length > 0 && (
                        <small>目标物 {draft.targetIds.join("、")}</small>
                      )}
                    </td>
                    <td>
                      <input
                        value={row.rowName}
                        maxLength={128}
                        disabled={busy}
                        aria-label={`槽位 ${draft.modelIndexes.join("、")} 的 DialogNPCTable 行名`}
                        aria-invalid={
                          messages.some((message) =>
                            message.includes("行名"),
                          )
                        }
                        onChange={(event) =>
                          updateRow(index, {
                            rowName: event.target.value
                              .replace(/[^A-Za-z0-9_]/g, "")
                              .slice(0, 128),
                          })
                        }
                      />
                    </td>
                    <td title={row.characterClassPath}>
                      <code>{assetName(row.characterClassPath)}</code>
                    </td>
                    <td>
                      <code title={row.animClassPath}>
                        {assetName(row.animClassPath) || "未读取"}
                      </code>
                      <small title={row.meshPath}>
                        {assetName(row.meshPath) || "未读取 Mesh"}
                      </small>
                    </td>
                    <td>
                      <input
                        list="dialog-npc-camera-options"
                        value={row.cameraClassPath}
                        disabled={busy}
                        spellCheck={false}
                        aria-label={`槽位 ${draft.modelIndexes.join("、")} 的 Camera BP`}
                        aria-invalid={!row.cameraClassPath}
                        placeholder="选择或粘贴 Camera BP 路径"
                        onChange={(event) =>
                          updateRow(index, {
                            cameraClassPath: event.target.value.trim(),
                          })
                        }
                      />
                      <small>{cameraSuggestionLabel(draft.cameraSuggestionSource)}</small>
                    </td>
                    <td>
                      {messages.length === 0 ? (
                        <span className="dialogue-model-status dialogue-model-status--pending">
                          <CheckCircle2 size={12} />
                          可登记
                        </span>
                      ) : (
                        <>
                          <span className="dialogue-model-status dialogue-model-status--warning">
                            <AlertTriangle size={12} />
                            待处理
                          </span>
                          <small title={messages.join("；")}>
                            {messages.join("；")}
                          </small>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="dialog-npc-camera-options">
            {review.cameraClassPaths.map((path) => (
              <option key={path} value={path}>
                {assetName(path)}
              </option>
            ))}
          </datalist>
        </div>

        {error && (
          <div className="dialog-npc-registration-error" role="alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        <footer>
          <span>
            {invalidCount > 0
              ? `${invalidCount} 项需要处理`
              : `将新增 ${rows.length} 行并保存 ${review.tableAssetPath}`}
          </span>
          <div>
            <button
              className="button"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              取消
            </button>
            <button
              className="button button--primary"
              type="submit"
              disabled={busy || invalidCount > 0}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              {busy ? "正在登记..." : "保存登记"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
