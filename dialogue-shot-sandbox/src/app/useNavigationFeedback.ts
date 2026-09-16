import { useState } from "react";

/**
 * Scope input feedback to the workbench. Native keyboard/assistive clicks have
 * detail=0; pointer movement alone must not re-enable motion during keyboard use.
 */
export function useNavigationFeedback() {
  const [input, setInput] = useState<"pointer" | "keyboard">("keyboard");

  return {
    "data-navigation-input": input,
    onPointerDownCapture: () => setInput("pointer"),
    onKeyDownCapture: () => setInput("keyboard"),
    onClickCapture: (event: { detail: number }) => {
      if (event.detail === 0) setInput("keyboard");
    },
  };
}
