import { useState } from "react";

/**
 * Scope input feedback to the shell. Native keyboard/assistive clicks have
 * detail=0; pointer movement alone must not re-enable motion during keyboard use.
 */
export function useNavigationFeedback() {
  const [input, setInput] = useState<"pointer" | "keyboard">("keyboard");

  return {
    "data-navigation-input": input,
    onPointerDownCapture: () => setInput("pointer"),
    onKeyDownCapture: () => setInput("keyboard"),
    onClickCapture: (event: { detail: number; currentTarget: HTMLElement }) => {
      if (event.detail === 0) {
        // Navigation reads this during the same event, before React commits state.
        event.currentTarget.dataset.navigationInput = "keyboard";
        setInput("keyboard");
      }
    },
  };
}
