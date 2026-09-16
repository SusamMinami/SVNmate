import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** Shared dismissal/focus rules; CSS discrete transitions retain the exit frame. */
export function useStatusPopover(disabled = false) {
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const id = useId();
  const visible = open && !disabled;

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (visible && instant) panelRef.current?.focus({ preventScroll: true });
  }, [visible, instant]);

  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setInstant(event.type === "focusin");
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setInstant(true);
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [visible]);

  return {
    rootRef,
    close: () => setOpen(false),
    triggerProps: {
      ref: triggerRef,
      "aria-controls": id,
      "aria-expanded": visible,
      onClick: (event: { detail: number }) => {
        setInstant(event.detail === 0);
        setOpen((current) => !current);
      },
    },
    panelProps: {
      ref: panelRef,
      id,
      tabIndex: -1,
      "data-open": visible,
      "data-instant": instant,
      "aria-hidden": !visible || undefined,
      inert: !visible || undefined,
    },
  };
}
