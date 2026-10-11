/**
 * Build/deploy duration helpers, shared by every surface that shows how long a
 * deployment took (or is taking): the deployment detail timeline, the resource
 * graph node, and the deployment history rows.
 */

import { useEffect, useState } from "react";

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Format a millisecond span: `9s` / `1m 04s` / `1h 03m`. The ONE duration
 * format: took, elapsed, the median and the pipeline all read it, so a column
 * of durations lines up and compares at a glance. The smaller unit is always
 * shown and zero-padded (`1m 00s`, never `1m`). Not `mm:ss`: beside a clock
 * column, `02:14` reads as a time of day.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${pad2(total % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad2(minutes % 60)}m`;
}

/**
 * A clock that re-renders on an interval while `live`, and freezes otherwise.
 *
 * Exposed because callers that count *down* (an expiry) need the raw instant,
 * not the start→end span `useLiveDuration` returns.
 */
export function useNowTick(live: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [live, intervalMs]);
  return now;
}

/**
 * Elapsed time from `start` to `end`, or to *now*, re-rendering every second
 * while `end` is null (the build/deploy is still in flight). Returns the
 * formatted string, or null when there's no start (nothing to time yet).
 */
export function useLiveDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const now = useNowTick(!end);
  if (!start) return null;
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : now;
  return formatDuration(endMs - startMs);
}
