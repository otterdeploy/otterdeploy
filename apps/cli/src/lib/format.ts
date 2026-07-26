/**
 * Value formatting shared by every command that prints an id, a timestamp or a
 * duration.
 *
 * These were duplicated with quiet disagreements before: two `relativeTime`s
 * (one of which couldn't express a future time, so certificate expiry read as
 * "5m ago"), and two `shortId`s (one prefix-aware, one a blind 12-character
 * slice). Unifying them means the same deployment id looks identical in
 * `deployments`, `rollback` and `logs`, which is what makes it usable as a
 * handle the user can copy between commands.
 */

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 1440;

/**
 * A human interval relative to now, in either direction: `4m ago`, `in 2h`.
 *
 * Bidirectional on purpose — the same helper renders "created 3h ago" and
 * "expires in 30d", and a one-directional version silently mislabels the latter.
 */
export function relativeTime(iso: string): string {
  const delta = new Date(iso).getTime() - Date.now();
  const minutes = Math.max(1, Math.round(Math.abs(delta) / MINUTE_MS));
  const human =
    minutes < HOUR_MINUTES
      ? `${minutes}m`
      : minutes < DAY_MINUTES
        ? `${Math.round(minutes / HOUR_MINUTES)}h`
        : `${Math.round(minutes / DAY_MINUTES)}d`;
  return delta >= 0 ? `in ${human}` : `${human} ago`;
}

/**
 * An id shortened to something eyeballable while keeping its type prefix:
 * `dpl_01hxk2mq`. The prefix is what tells a reader *what* the id names, so it
 * survives truncation; the entropy after it is only ever compared, not read.
 *
 * Commands that accept these resolve prefixes server-side, and `--json` always
 * carries the full value.
 */
export function shortId(id: string): string {
  const sep = id.indexOf("_");
  return sep === -1 ? id.slice(0, 8) : `${id.slice(0, sep + 1)}${id.slice(sep + 1, sep + 9)}`;
}

/** Git's conventional 7-character abbreviation. */
export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "";
}

/** Clip to `max` printable characters, marking the cut with an ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Elapsed time between two timestamps, as `1m24s` / `12s` / `2h5m`.
 *
 * Deploy durations are the number people actually compare between builds, so
 * they read as a compact span rather than a relative time.
 */
export function elapsed(fromIso: string, toIso: string | null | undefined): string {
  if (!toIso) return "";
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

/** An em dash for a value that is genuinely absent, dimmed by the caller. */
export const ABSENT = "—";

// Binary units, because the divisor is 1024. The two formatters this replaced
// disagreed: one divided by 1024 and labelled the result "MB", which overstates
// every size by ~5% at the GiB scale. Dividing by 1024 and saying MiB is the
// only self-consistent pair.
const BYTE_UNITS = ["KiB", "MiB", "GiB", "TiB"] as const;
const BYTE_STEP = 1024;
/** Below this, show one decimal; above it the fraction is noise. */
const DECIMAL_CUTOFF = 10;

/** Byte counts as `4.2 MiB` / `18 GiB`. Absent sizes render as the absent marker. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return ABSENT;
  const negative = bytes < 0;
  let value = Math.abs(bytes);
  let unit = "B";
  for (const next of BYTE_UNITS) {
    if (value < BYTE_STEP) break;
    value /= BYTE_STEP;
    unit = next;
  }
  const rounded = value >= DECIMAL_CUTOFF || unit === "B" ? Math.round(value) : value.toFixed(1);
  return `${negative ? "-" : ""}${rounded} ${unit}`;
}

/** `value` or the absent marker, so empty cells are explicit rather than blank. */
export function orAbsent(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? ABSENT : value;
}
