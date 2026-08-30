import {
  AlertTriangle,
  ArrowRight,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import type { MissingBlueprintNpcModel } from "../data/blueprintFormation";

interface MissingNpcModelModalProps {
  issues: MissingBlueprintNpcModel[];
  ignoredNpcIds: ReadonlySet<number>;
  busy: boolean;
  status: string;
  error: string;
  onToggle: (npcId: number) => void;
  onToggleAll: () => void;
  onRefresh: () => void;
  onContinue: () => void;
  onClose: () => void;
}

export function MissingNpcModelModal({
  issues,
  ignoredNpcIds,
  busy,
  status,
  error,
  onToggle,
  onToggleAll,
  onRefresh,
  onContinue,
  onClose,
}: MissingNpcModelModalProps) {
  const ignoredCount = issues.filter((issue) =>
    ignoredNpcIds.has(issue.npcId),
  ).length;
  const allIgnored = issues.length > 0 && ignoredCount === issues.length;

  return (
    <div className="modal-backdrop missing-npc-model-backdrop" role="presentation">
      <section
        className="missing-npc-model-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="missing-npc-model-title"
      >
        <header>
          <span>
            <AlertTriangle size={18} />
          </span>
          <div>
            <small>BP 角色检查</small>
            <h2 id="missing-npc-model-title">确认缺失模型 NPC</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭缺失模型确认"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="missing-npc-model-modal__body">
          <p>
            以下对白角色无法映射到当前 BP。勾选允许忽略的角色后，可改用规则占位继续分镜设计。
          </p>
          <label className="missing-npc-model-modal__all">
            <input
              type="checkbox"
              checked={allIgnored}
              ref={(element) => {
                if (element) {
                  element.indeterminate = ignoredCount > 0 && !allIgnored;
                }
              }}
              disabled={busy}
              onChange={onToggleAll}
            />
            <span>忽略全部缺失角色</span>
            <small>{ignoredCount} / {issues.length}</small>
          </label>
          <div className="missing-npc-model-list">
            {issues.map((issue) => (
              <label key={issue.npcId}>
                <input
                  type="checkbox"
                  checked={ignoredNpcIds.has(issue.npcId)}
                  disabled={busy}
                  onChange={() => onToggle(issue.npcId)}
                  aria-label={`忽略 NPC ${issue.npcName} 的模型缺失`}
                />
                <span>
                  <strong>
                    {issue.npcName}
                    <code>{issue.npcId}</code>
                  </strong>
                  <small>
                    {issue.dialogueIds.length} 个台词节点 · {issue.reason}
                  </small>
                  {issue.expectedModelClassPath && (
                    <code title={issue.expectedModelClassPath}>
                      {issue.expectedModelClassPath}
                    </code>
                  )}
                </span>
              </label>
            ))}
          </div>
          {status && (
            <p className="missing-npc-model-modal__status" role="status">
              {status}
            </p>
          )}
          {error && (
            <p className="missing-npc-model-modal__error" role="alert">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </p>
          )}
        </div>

        <footer>
          <span>
            {allIgnored
              ? "将保留对白，并使用规则占位继续设计"
              : "未勾选的缺失角色仍会阻止继续"}
          </span>
          <div>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={onRefresh}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              {busy ? "正在刷新..." : "刷新 BP"}
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={busy || !allIgnored}
              onClick={onContinue}
            >
              <ArrowRight size={15} />
              忽略并继续
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
