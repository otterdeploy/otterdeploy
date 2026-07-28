/**
 * Pure-text formatters for display in CLI output, UI labels, and logs.
 * No platform deps — safe to import from any package.
 */

/** Placeholder for a value the caller doesn't have. Shared so a column of
 *  formatted cells lines up on the same glyph. */
export const ABSENT = "—";

// Binary (1024) units — every figure this formats (Docker images, registry
// manifests, host disk) is reported in powers of two.
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Human-readable byte size. Whole bytes carry no useful fraction, so `B`
 * always renders as an integer; every larger unit gets `decimals` places.
 * Missing, non-finite, and negative inputs render as {@link ABSENT} rather
 * than a fabricated "0 B" — a size we don't have is not a size of zero.
 *
 *   formatBytes(0)              // "0 B"
 *   formatBytes(2048)           // "2.0 KB"
 *   formatBytes(15 * 1024 ** 3) // "15.0 GB"
 *   formatBytes(null)           // "—"
 */
export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ABSENT;
  if (bytes === 0) return "0 B";
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : decimals)} ${BYTE_UNITS[i]}`;
}

/**
 * Group-separated integer/decimal for display (thousands separators per the
 * runtime locale). Cached `Intl.NumberFormat` so repeated calls in a list
 * don't re-build the formatter. `null`/`undefined`/non-finite → "—".
 *
 *   formatNumber(17687)   // "17,687"
 *   formatNumber(0)       // "0"
 *   formatNumber(null)    // "—"
 */
const numberFormatter = new Intl.NumberFormat();
export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  return numberFormatter.format(value);
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
