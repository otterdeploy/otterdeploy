/**
 * Compact human durations for analytics readings: `1m 24s`, `2h 5m`, `47s`.
 * Two units at most — an average visit does not need millisecond theatre —
 * and `null` (a window with no sessions) renders as an en dash, never a fake
 * zero.
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

export function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "–";
  const totalSeconds = Math.round(ms / SECOND_MS);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(ms / HOUR_MS);
  if (hours >= 1) {
    const minutes = Math.round((ms - hours * HOUR_MS) / MINUTE_MS);
    // 1h 60m is 2h; carry rather than print an impossible reading.
    if (minutes === 60) return `${hours + 1}h 0m`;
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/** "12 s ago" / "3 min ago" / "2 h ago" for the realtime lists. Sub-5-second
 *  readings say "now": a live row jittering 1s→3s→2s is noise, not honesty. */
export function formatAgo(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 5 * SECOND_MS) return "now";
  if (elapsedMs < MINUTE_MS) return `${Math.floor(elapsedMs / SECOND_MS)} s ago`;
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)} min ago`;
  return `${Math.floor(elapsedMs / HOUR_MS)} h ago`;
}
