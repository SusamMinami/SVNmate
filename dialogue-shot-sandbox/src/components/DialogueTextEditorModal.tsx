import {
  Check,
  FilePenLine,
  LoaderCircle,
  Replace,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DialogueContentUpdateRequest } from "../types";

export interface DialogueTextEditorItem {
  dialogueId: string;
  startId: string;
  dialogueNodeId: string;
  speakerName: string;
  content: string;
}

interface DialogueTextEditorModalProps {
  query: string;
  items: DialogueTextEditorItem[];
  activeDialogueNodeId: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onApply: (items: DialogueContentUpdateRequest[]) => void;
}

function replaceLiteral(
  content: string,
  query: string,
  replacement: string,
): string {
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.replace(new RegExp(pattern, "giu"), replacement);
}

export function DialogueTextEditorModal({
  query,
  items,
  activeDialogueNodeId,
  busy,
  error,
  onClose,
  onApply,
}: DialogueTextEditorModalProps) {
  const activeItem =
    items.find((item) => item.dialogueNodeId === activeDialogueNodeId) ??
    items[0];
  const [mode, setMode] = useState<"single" | "batch">(
    items.length > 1 ? "batch" : "single",
  );
  const [singleDraft, setSingleDraft] = useState(activeItem?.content ?? "");
  const [replacement, setReplacement] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(activeItem ? [activeItem.dialogueNodeId] : []),
  );
  const batchRows = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        nextContent: replacement
          ? replaceLiteral(item.content, query, replacement)
          : item.content,
      })),
    [items, query, replacement],
  );
  const selectedCount = batchRows.filter((item) =>
    selectedIds.has(item.dialogueNodeId),
  ).length;
  const allSelected =
    batchRows.length > 0 && selectedCount === batchRows.length;
  const batchChanges = batchRows
    .filter(
      (item) =>
        selectedIds.has(item.dialogueNodeId) &&
        item.nextContent !== item.content,
    )
    .map((item) => ({
      dialogueId: item.dialogueId,
      startId: item.startId,
      dialogueNodeId: item.dialogueNodeId,
      previousContent: item.content,
      content: item.nextContent,
    }));
  const batchHasEmptyContent = batchChanges.some(
    (item) => !item.content.trim(),
  );
  const singleContent = singleDraft.trim();
  const singleChanged =
    Boolean(activeItem) &&
    singleContent.length > 0 &&
    singleContent !== activeItem.content;

  function toggleItem(dialogueNodeId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(dialogueNodeId)) {
        next.delete(dialogueNodeId);
      } else {
        next.add(dialogueNodeId);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(
      allSelected
        ? new Set()
        : new Set(batchRows.map((item) => item.dialogueNodeId)),
    );
  }

  function applyChanges() {
    if (mode === "single") {
      if (!activeItem || !singleChanged) {
        return;
      }
      onApply([
        {
          dialogueId: activeItem.dialogueId,
          startId: activeItem.startId,
          dialogueNodeId: activeItem.dialogueNodeId,
          previousContent: activeItem.content,
          content: singleContent,
        },
      ]);
      return;
    }
    if (batchChanges.length > 0 && !batchHasEmptyContent) {
      onApply(batchChanges);
    }
  }

  return (
    <div className="modal-backdrop dialogue-text-editor-backdrop" role="presentation">
      <section
        className="dialogue-text-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialogue-text-editor-title"
      >
        <header>
          <div className="dialogue-text-editor__title">
            <span>
              <FilePenLine size={18} />
            </span>
            <div>
              <small>UE DIALOGUE CONTENT</small>
              <h2 id="dialogue-text-editor-title">对白文本编辑</h2>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭对白文本编辑"
            onClick={onClose}
            disabled={busy}
          >
            <X size={17} />
          </button>
        </header>

        <div className="dialogue-text-editor__modes" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "single"}
            className={mode === "single" ? "is-active" : ""}
            onClick={() => setMode("single")}
            disabled={busy}
          >
            当前节点
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "batch"}
            className={mode === "batch" ? "is-active" : ""}
            onClick={() => setMode("batch")}
            disabled={busy}
          >
            批量替换
          </button>
        </div>

        {error && (
          <div className="dialogue-text-editor__error" role="alert">
            {error}
          </div>
        )}

        {mode === "single" ? (
          <div className="dialogue-text-editor__single">
            <div>
              <span>{activeItem?.speakerName ?? "未知角色"}</span>
              <code>{activeItem?.dialogueNodeId ?? "-"}</code>
            </div>
            <textarea
              autoFocus
              aria-label="当前节点对白"
              value={singleDraft}
              onChange={(event) => setSingleDraft(event.target.value)}
              disabled={busy || !activeItem}
            />
          </div>
        ) : (
          <>
            <div className="dialogue-text-editor__replace">
              <label>
                查找
                <input value={query} readOnly aria-label="批量查找内容" />
              </label>
              <Replace size={17} aria-hidden="true" />
              <label>
                替换为
                <input
                  autoFocus
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                  aria-label="批量替换内容"
                  placeholder="输入替换文本"
                  disabled={busy}
                />
              </label>
            </div>
            <div className="dialogue-text-editor__table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(element) => {
                          if (element) {
                            element.indeterminate =
                              selectedCount > 0 && !allSelected;
                          }
                        }}
                        onChange={toggleAll}
                        aria-label="选择全部匹配对白"
                      />
                    </th>
                    <th>对话 / 节点</th>
                    <th>角色</th>
                    <th>当前文本</th>
                    <th>替换预览</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((item) => {
                    const selected = selectedIds.has(item.dialogueNodeId);
                    return (
                      <tr
                        key={`${item.startId}:${item.dialogueNodeId}`}
                        className={selected ? undefined : "is-unselected"}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleItem(item.dialogueNodeId)}
                            aria-label={`选择对白节点 ${item.dialogueNodeId}`}
                            disabled={busy}
                          />
                        </td>
                        <td>
                          <strong>{item.dialogueId}</strong>
                          <code>{item.dialogueNodeId}</code>
                        </td>
                        <td>{item.speakerName}</td>
                        <td>{item.content}</td>
                        <td>{item.nextContent}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <footer>
          <span>
            {mode === "single"
              ? `节点 ${activeItem?.dialogueNodeId ?? "-"}`
              : `已选择 ${selectedCount} / ${batchRows.length} 条，${batchChanges.length} 条将修改`}
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
              type="button"
              onClick={applyChanges}
              disabled={
                busy ||
                (mode === "single"
                  ? !singleChanged
                  : !replacement ||
                    batchChanges.length === 0 ||
                    batchHasEmptyContent)
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Check size={15} />
              )}
              {busy
                ? "正在写入..."
                : mode === "single"
                  ? "保存当前节点"
                  : `应用 ${batchChanges.length} 条`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
