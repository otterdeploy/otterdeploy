/**
 * Remember where the grid was scrolled, per table, across refreshes.
 *
 * The grid scrolls its own element, so the router's window-level restoration
 * cannot see it. The offset goes to sessionStorage on scroll (rAF-throttled)
 * and is applied once per key when the rows are actually there to scroll —
 * restoring against an empty grid clamps to zero and loses the position.
 */
import { useEffect, useRef, type RefObject } from "react";

export function useGridScrollMemory(
  wrapRef: RefObject<HTMLDivElement | null>,
  key: string,
  ready: boolean,
) {
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    const el = wrapRef.current?.querySelector('[data-slot="grid"]');
    if (!(el instanceof HTMLElement) || !ready) return;

    if (restoredFor.current !== key) {
      restoredFor.current = key;
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        const [top = "0", left = "0"] = saved.split(":");
        el.scrollTop = Number(top) || 0;
        el.scrollLeft = Number(left) || 0;
      }
    }

    // Written synchronously: a sessionStorage set is microseconds, scroll
    // fires at most per-frame, and the obvious rAF throttle silently never
    // runs in a hidden tab — which is exactly when a refresh is coming.
    const onScroll = () => {
      sessionStorage.setItem(key, `${Math.round(el.scrollTop)}:${Math.round(el.scrollLeft)}`);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [wrapRef, key, ready]);
}
