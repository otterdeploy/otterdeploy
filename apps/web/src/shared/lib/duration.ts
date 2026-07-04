/**
 * Build/deploy duration helpers, shared by every surface that shows how long a
 * deployment took (or is taking): the deployment detail timeline, the resource
 * graph node, and the deployment history rows.
 */

import { useEffect, useState } from "react";

/** Format a millisecond span compactly: `45s` / `1m 28s` / `1h 3m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Elapsed time from `start` to `end` — or to *now*, re-rendering every second
 * while `end` is null (the build/deploy is still in flight). Returns the
 * formatted string, or null when there's no start (nothing to time yet).
 */
export function useLiveDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const live = !end;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  if (!start) return null;
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : now;
  return formatDuration(endMs - startMs);
}
