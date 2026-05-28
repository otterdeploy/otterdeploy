/**
 * Pure-text formatters for display in CLI output, UI labels, and logs.
 * No platform deps — safe to import from any package.
 */

/**
 * Human-readable byte size. Returns `null` when the input is null so
 * callers can pipe through "value or empty" rendering without an extra
 * branch.
 *
 *   formatBytes(0)          // "0B"
 *   formatBytes(2048)       // "2.0KB"
 *   formatBytes(15 * 1024**3) // "15.00GB"
 */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

/**
 * "x minutes ago" / "x days ago" string for a timestamp. Accepts a
 * `Date` or anything `new Date(x)` can parse (string, number). Tops
 * out at years — beyond that there's not much value in "47y ago".
 *
 *   formatRelative(new Date(Date.now() - 30_000))            // "just now"
 *   formatRelative(new Date(Date.now() - 2 * 60_000))        // "2m ago"
 *   formatRelative(new Date(Date.now() - 5 * 24*3600*1000))  // "5d ago"
 */
export function formatRelative(date: Date | string | number): string {
  const ms = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
