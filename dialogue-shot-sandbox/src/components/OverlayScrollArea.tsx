import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

interface OverlayScrollAreaProps {
  children: ReactNode;
  className?: string;
  hidden?: boolean;
  id?: string;
  role?: string;
}

interface ScrollMetrics {
  visible: boolean;
  height: number;
  top: number;
}

const TRACK_INSET = 4;
const MIN_THUMB_HEIGHT = 28;

export function OverlayScrollArea({
  children,
  className = "",
  hidden,
  id,
  role,
}: OverlayScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
  } | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    visible: false,
    height: 0,
    top: 0,
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewportHeight = element.clientHeight;
        const contentHeight = element.scrollHeight;
        const trackHeight = Math.max(0, viewportHeight - TRACK_INSET * 2);
        if (contentHeight <= viewportHeight + 1 || trackHeight <= 0) {
          setMetrics({ visible: false, height: 0, top: 0 });
          return;
        }
        const height = Math.min(
          trackHeight,
          Math.max(
            MIN_THUMB_HEIGHT,
            trackHeight * (viewportHeight / contentHeight),
          ),
        );
        const travel = Math.max(0, trackHeight - height);
        const top =
          TRACK_INSET +
          travel * (element.scrollTop / (contentHeight - viewportHeight));
        setMetrics({ visible: true, height, top });
      });
    };
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(element);
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [hidden]);

  function moveThumb(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const element = scrollRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !element) {
      return;
    }
    const trackHeight = element.clientHeight - TRACK_INSET * 2;
    const travel = Math.max(1, trackHeight - metrics.height);
    const scrollTravel = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop =
      drag.startScrollTop +
      (event.clientY - drag.startY) * (scrollTravel / travel);
  }

  function stopDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  return (
    <div className="inspector-scroll-frame" hidden={hidden}>
      <div
        className={className}
        id={id}
        ref={scrollRef}
        role={role}
        tabIndex={0}
      >
        {children}
      </div>
      {metrics.visible && (
        <div className="inspector-overlay-scrollbar" aria-hidden="true">
          <div
            className="inspector-overlay-scrollbar__thumb"
            style={{
              height: `${metrics.height}px`,
              transform: `translateY(${metrics.top}px)`,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              scrollRef.current?.focus({ preventScroll: true });
              dragRef.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startScrollTop: scrollRef.current?.scrollTop ?? 0,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={moveThumb}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
          />
        </div>
      )}
    </div>
  );
}
