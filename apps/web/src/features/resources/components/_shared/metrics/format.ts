/**
 * Display formatters for the resource metrics panel. Bytes use binary (1024)
 * units to match Docker's stats output (`mem_bytes`, `net_*_bytes`); rates are
 * derived per-second values, so they get a `/s` suffix.
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** Human-readable byte size, e.g. `512 MB`, `1.4 GB`. */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** i;
  // Whole bytes have no useful fraction; everything else keeps one decimal.
  return `${value.toFixed(i === 0 ? 0 : fractionDigits)} ${BYTE_UNITS[i]}`;
}

/** Throughput, e.g. `1.2 MB/s`. */
export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond == null) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** CPU / memory percentage. CPU can exceed 100% on multi-core hosts. */
export function formatPercent(pct: number, fractionDigits = 0): string {
  if (!Number.isFinite(pct)) return "—";
  return `${pct.toFixed(fractionDigits)}%`;
}

/** Clock label for chart axes / tooltips, e.g. `14:32`. */
export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Clock label with seconds, used for the "updated at" caption. */
export function formatClockSeconds(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
