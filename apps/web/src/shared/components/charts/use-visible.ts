/**
 * Has this element been scrolled into view yet?
 *
 * A metrics page mounts a dozen charts, most of them below the fold. Building a
 * chart definition and its scene for a chart nobody has looked at is work spent
 * on nothing, and it happens on the same tick as the visible ones.
 *
 * The observer callback IS the event, so state is set there — the only place it
 * belongs. Nothing is written during render and nothing is set from an effect;
 * the effect exists solely to subscribe and unsubscribe.
 */

import { useEffect, useRef, useState } from "react";

export interface VisibilityHandle<T extends Element> {
  ref: React.RefObject<T | null>;
  /** True once the element has entered the viewport, and true from the start
   *  where IntersectionObserver is unavailable. Never returns to false: this
   *  gates first paint, not a live subscription, so a chart that has been read
   *  once stays mounted and keeps its scroll position and focus. */
  seen: boolean;
}

export function useVisible<T extends Element>(rootMargin = "200px"): VisibilityHandle<T> {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Set from the observer's own callback, then stop observing: this is a
        // one-way latch, so there is nothing left to watch.
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setSeen(true);
        }
      },
      // Runs ahead of the fold so a chart is already drawn by the time it
      // reaches the viewport rather than visibly appearing late.
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, seen]);

  return { ref, seen };
}
