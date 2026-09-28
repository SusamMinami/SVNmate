export interface ConfigurationActivity {
  state: "dialogue" | "other" | "unknown";
  message: string;
}

export interface ForegroundWindow {
  processId: number;
  processName: string;
  title: string;
}

/** Only recognize the project's exact dialogue asset caption or an explicit editor caption.
 * Generic/docked UE captions are deliberately unknown; users can disable automatic pausing.
 */
export function classifyConfigurationWindow(window: ForegroundWindow): ConfigurationActivity {
  if (!/^UE4Editor(?:-Win64-(?:Debug|Development))?$/i.test(window.processName)) {
    return { state: "other", message: "当前在其他应用中，已暂停 UE 自动读取" };
  }
  const title = window.title.trim();
  if (/^\d{6}\s*\*?$/.test(title) ||
    /^(?:Seria\s*)?(?:对话编辑器|Dialogue Editor)(?:\s*[-:：].*)?$/i.test(title)) {
    return { state: "dialogue", message: "对话编辑器已激活" };
  }
  return {
    state: "unknown",
    message: "当前 UE 窗口未识别为对话编辑器，已暂停自动读取",
  };
}
