/**
 * Wall-clock hook for the update progress pane: elapsed time while a
 * condition holds (the whole run, the cutover wait). Ticks at 1s because the
 * pane renders mm:ss, so finer re-renders buy nothing.
 */
import { useEffect, useState } from "react";

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Milliseconds since `active` last became true, ticking once a second.
 * Freezes at its last value (rather than resetting) when `active` goes false,
 * so a settled run keeps showing its final duration; re-activating restarts
 * from zero. Entirely effect-driven: the render path never reads the clock.
 */
export function useElapsedSince(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    // No synchronous reset here (cascading-render lint): on a re-activation
    // the previous frozen value lingers for at most one tick before the
    // interval overwrites it, which no reader of a mm:ss clock can see.
    const id = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}
