// 30 buckets x 1 minute, anchored at "now". Counts come from whatever's
// currently in the live buffer — anything older than 30min has scrolled off
// and isn't represented.

import type { LogLevel, LogLine } from "./use-project-log-stream";

export interface HistogramBucket {
  debug: number;
  info: number;
  warn: number;
  error: number;
}

export const HISTOGRAM_BUCKETS = 30;
export const HISTOGRAM_BUCKET_MS = 60_000;

export function bucketize(lines: LogLine[], now = Date.now()): HistogramBucket[] {
  const buckets: HistogramBucket[] = Array.from({ length: HISTOGRAM_BUCKETS }, () => ({
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  }));
  const earliest = now - HISTOGRAM_BUCKETS * HISTOGRAM_BUCKET_MS;
  for (const l of lines) {
    const ms = l.tsIso ? new Date(l.tsIso).getTime() : NaN;
    if (Number.isNaN(ms) || ms < earliest || ms > now) continue;
    const idx = Math.min(HISTOGRAM_BUCKETS - 1, Math.floor((ms - earliest) / HISTOGRAM_BUCKET_MS));
    const b = buckets[idx];
    if (b) b[l.level satisfies LogLevel] += 1;
  }
  return buckets;
}
