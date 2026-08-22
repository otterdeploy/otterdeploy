/**
 * A span of seconds as its two most significant units: "29d 21h", "19h 1m",
 * "42m", "<1m".
 *
 * Two units, not one, because "29d" alone loses most of a day and "29d 21h
 * 30m 27s" is not read, it is skipped. Callers own their own edge cases —
 * this only formats a positive span, so "expired" vs "just started" vs "we
 * don't know" stays each surface's decision rather than being smuggled in
 * here as a magic string.
 */
export function humanizeSeconds(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return "<1m";
}

/** Compact relative time ("2m ago", "3d ago"), falling back to an absolute
 *  date past a month. Callers put the full timestamp in a `title`, so the cell
 *  stays scannable while the exact value is one hover away. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
