/**
 * Display formatters for the resource metrics panel. Byte sizes come from
 * `@otterdeploy/shared/format` — Docker reports stats (`mem_bytes`,
 * `net_*_bytes`) in binary units, which is what that formatter speaks — and
 * this file adds only what is metrics-specific: the `/s` rate suffix, the
 * percentage, and the chart clock labels.
 */

import { ABSENT, formatBytes } from "@otterdeploy/shared/format";

export { formatBytes };

/** Throughput, e.g. `1.2 MB/s`. */
export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond == null) return ABSENT;
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** CPU / memory percentage. CPU can exceed 100% on multi-core hosts. */
export function formatPercent(pct: number, fractionDigits = 0): string {
  if (!Number.isFinite(pct)) return ABSENT;
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
