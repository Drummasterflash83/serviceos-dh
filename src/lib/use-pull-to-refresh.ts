import { useEffect, useRef, useState } from "react";

const TRIGGER_DISTANCE = 76;

/** A touch-only refresh gesture. It never cancels ordinary scrolling. */
export function usePullToRefresh(onRefresh: () => Promise<unknown>, enabled = true) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const currentDistance = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    function touchStart(event: TouchEvent) {
      if (
        busy.current ||
        event.touches.length !== 1 ||
        window.scrollY > 2 ||
        (event.target as Element | null)?.closest(
          "input, textarea, select, button, a, [role='dialog']",
        )
      ) {
        start.current = null;
        return;
      }
      start.current = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY };
    }
    function touchMove(event: TouchEvent) {
      if (!start.current || event.touches.length !== 1) return;
      const dx = event.touches[0]!.clientX - start.current.x;
      const dy = event.touches[0]!.clientY - start.current.y;
      if (dy <= 0 || Math.abs(dx) > dy * 0.65) return;
      currentDistance.current = Math.min(dy, 120);
      setDistance(currentDistance.current);
    }
    function touchEnd() {
      const shouldRefresh = start.current && currentDistance.current >= TRIGGER_DISTANCE;
      start.current = null;
      currentDistance.current = 0;
      setDistance(0);
      if (!shouldRefresh || busy.current) return;
      busy.current = true;
      setRefreshing(true);
      void Promise.resolve()
        .then(onRefresh)
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
          setRefreshing(false);
        });
    }
    function touchCancel() {
      start.current = null;
      currentDistance.current = 0;
      setDistance(0);
    }
    document.addEventListener("touchstart", touchStart, { passive: true });
    document.addEventListener("touchmove", touchMove, { passive: true });
    document.addEventListener("touchend", touchEnd, { passive: true });
    document.addEventListener("touchcancel", touchCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", touchStart);
      document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("touchend", touchEnd);
      document.removeEventListener("touchcancel", touchCancel);
    };
  }, [enabled, onRefresh]);

  return { distance, refreshing, ready: distance >= TRIGGER_DISTANCE };
}
