/**
 * Display formatters for the resource metrics panel. Byte sizes come from
 * `@otterdeploy/shared/format`: Docker reports stats (`mem_bytes`,
 * `net_*_bytes`) in binary units, which is what that formatter speaks, and
 * this file adds only what is metrics-specific: the `/s` rate suffix, the
 * percentage, and the live caption's clock.
 */

import { ABSENT, formatBytes } from "@otterdeploy/shared/format";

import { CLOCK_SECONDS, clockFormatter } from "@/shared/lib/clock";

export { formatBytes };

/** Throughput, e.g. `1.2 MB/s`. */
export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond == null) return ABSENT;
  return `${formatBytes(bytesPerSecond)}/s`;
}

const percentFormats = new Map<number, Intl.NumberFormat>();

/** CPU / memory percentage. CPU can exceed 100% on multi-core hosts.
 *  `maxFractionDigits` is a ceiling, not a fixed width: an axis that reads
 *  `0%, 5%, 10%` should not become `0.0%, 5.0%, 10.0%` because one tick
 *  somewhere needed a decimal. */
export function formatPercent(pct: number, maxFractionDigits = 0): string {
  if (!Number.isFinite(pct)) return ABSENT;
  let format = percentFormats.get(maxFractionDigits);
  if (!format) {
    format = new Intl.NumberFormat(undefined, { maximumFractionDigits: maxFractionDigits });
    percentFormats.set(maxFractionDigits, format);
  }
  return `${format.format(pct)}%`;
}

/** Clock label with seconds, used for the "updated at" caption. 24-hour, to
 *  match the chart axis it sits beside. */
export const formatClockSeconds: (epochMs: number) => string = clockFormatter(CLOCK_SECONDS);
