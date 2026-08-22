import { Check, Clipboard, X } from "lucide-react";
import { useState } from "react";
import type { TraeMcpConfig } from "../trae/client";

interface TraeCollaborationModalProps {
  config: TraeMcpConfig;
  onClose: () => void;
  onRefresh: () => void;
}

export function TraeCollaborationModal({
  config,
  onClose,
  onRefresh,
}: TraeCollaborationModalProps) {
  const [copied, setCopied] = useState(false);

  async function copyConfig() {
    await navigator.clipboard.writeText(config.configText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="collaboration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trae-collaboration-title"
      >
        <header>
          <div>
            <small>内部 TRAE 协作</small>
            <h2 id="trae-collaboration-title">连接分镜 MCP</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭内部 TRAE 配置"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div className="collaboration-modal__body">
          <ol>
            {config.instructions.map((instruction) => (
              <li key={instruction}>{instruction}</li>
            ))}
          </ol>
          <div className="config-path">
            <span>推荐项目配置位置</span>
            <code>{config.configPath}</code>
          </div>
          <div className="config-editor">
            <div>
              <span>项目级或全局 MCP 配置</span>
              <button type="button" onClick={() => void copyConfig()}>
                {copied ? <Check size={14} /> : <Clipboard size={14} />}
                {copied ? "已复制" : "复制配置"}
              </button>
            </div>
            <pre>{config.configText}</pre>
          </div>
          <p>
            Skill 已放在 <code>.agents/skills/internal-storyboard-director</code>。
            在 TRAE 的技能设置中启用 <code>.agents</code> 目录即可。
          </p>
        </div>

        <footer>
          <span>配置完成后，在内部 TRAE 输入“处理待分镜任务”。</span>
          <button className="button" type="button" onClick={onRefresh}>
            我已配置，刷新状态
          </button>
        </footer>
      </section>
    </div>
  );
}
