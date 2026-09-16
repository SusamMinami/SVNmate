import { useEffect, useId, useRef } from "react";

/** The compact header shares one hover delay; moving between its icons is instant. */
export function useStatusTooltips() {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let active: HTMLElement | null = null;
    let timer: number | undefined;
    let warmUntil = 0;
    let sequence = 0;
    const hide = () => {
      window.clearTimeout(timer);
      if (active?.dataset.tooltipOpen === "true") warmUntil = performance.now() + 600;
      active?.removeAttribute("data-tooltip-open");
      active?.removeAttribute("aria-describedby");
      active = null;
    };
    const iconAt = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>(".workspace-status-icon") : null;
    const enter = (event: PointerEvent | FocusEvent) => {
      const icon = iconAt(event.target);
      if (!icon || icon === active || icon.matches(":disabled")) return;
      if (event.type === "pointerover" && (event as PointerEvent).pointerType !== "mouse") return;
      if (event.type === "focusin" && !icon.matches(":focus-visible")) return;
      hide();
      if (icon.getAttribute("aria-expanded") === "true") return;
      const tooltip = icon.querySelector<HTMLElement>(".workspace-status-tooltip");
      if (!tooltip) return;
      active = icon;
      const instant = event.type === "focusin" || performance.now() < warmUntil;
      icon.dataset.tooltipInstant = String(instant);
      const show = () => {
        if (!icon.isConnected || icon.getAttribute("aria-expanded") === "true") return;
        tooltip.id ||= `${id}-tooltip-${sequence++}`;
        tooltip.setAttribute("role", "tooltip");
        icon.setAttribute("aria-describedby", tooltip.id);
        icon.dataset.tooltipOpen = "true";
      };
      if (instant) show();
      else timer = window.setTimeout(show, 350);
    };
    const leave = (event: PointerEvent | FocusEvent) => {
      if (active?.contains(event.relatedTarget as Node | null)) return;
      if (event.type === "pointerout" && active?.matches(":focus-visible")) return;
      hide();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    root.addEventListener("pointerover", enter);
    root.addEventListener("pointerout", leave);
    root.addEventListener("focusin", enter);
    root.addEventListener("focusout", leave);
    root.addEventListener("pointerdown", hide);
    document.addEventListener("keydown", key);
    return () => {
      hide();
      root.removeEventListener("pointerover", enter);
      root.removeEventListener("pointerout", leave);
      root.removeEventListener("focusin", enter);
      root.removeEventListener("focusout", leave);
      root.removeEventListener("pointerdown", hide);
      document.removeEventListener("keydown", key);
    };
  }, [id]);
  return ref;
}
