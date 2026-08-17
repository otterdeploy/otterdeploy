/**
 * Rollup readers for the Analytics surface. Everything here reads
 * `edge_stat_minute` / `edge_stat_day` — never the raw `edge_log` — so cost
 * is bounded by the window's bucket count, not by traffic volume, and the
 * 90-day range is as cheap as the 24-hour one.
 *
 * Freshness comes from merging the live in-process accumulators
 * ({@link snapshotAccumulators}) on top of the DB rows:
 * - Minute accs are UNFLUSHED DELTAS (flushed ones leave the map), so they
 *   ADD onto the series with no overlap by construction.
 * - Day accs are RUNNING TOTALS seeded from the DB, so for a (host, day) both
 *   sides know about, the live acc REPLACES the row (see mergedDayRows).
 */

import type { InternalBucket } from "./analytics-query-buckets";
import type {
  AnalyticsBreakdowns,
  AnalyticsFlags,
  AnalyticsRange,
  AnalyticsSummary,
  SeriesBucket,
  TopEntry,
} from "./analytics-query-shared";

import { snapshotAccumulators, OVERFLOW_KEY } from "./aggregate";
import {
  addIntoBucket,
  foldDayRowsIntoBuckets,
  foldLiveMinutesIntoBuckets,
  loadMinuteBuckets,
  newInternalBucket,
  percentileFromBuckets,
} from "./analytics-query-buckets";
import { coveringDayKeys, mergedDayRows, RANGES } from "./analytics-query-shared";

export { percentileFromBuckets } from "./analytics-query-buckets";
export type {
  AnalyticsBreakdowns,
  AnalyticsFlags,
  AnalyticsRange,
  AnalyticsSummary,
  SeriesBucket,
  TopEntry,
} from "./analytics-query-shared";

const TOP_N = 50;

/** Zero-filled output series + the whole-window totals. 0 requests is a real
 *  measurement, a gap is not. */
function buildSeries(
  buckets: Map<number, InternalBucket>,
  fromMs: number,
  nowMs: number,
  stepMs: number,
): { series: SeriesBucket[]; overall: InternalBucket } {
  const series: SeriesBucket[] = [];
  const overall = newInternalBucket(0);
  const firstStart = Math.floor(fromMs / stepMs) * stepMs;
  for (let startMs = firstStart; startMs <= nowMs; startMs += stepMs) {
    const b = buckets.get(startMs) ?? newInternalBucket(startMs);
    addIntoBucket(overall, b);
    series.push({
      t: new Date(startMs).toISOString(),
      requests: b.requests,
      botRequests: b.botRequests,
      s2xx: b.s2xx,
      s3xx: b.s3xx,
      s4xx: b.s4xx,
      s5xx: b.s5xx,
      sOther: b.sOther,
      resBytes: b.resBytes,
      p50: percentileFromBuckets(b.histogram, 0.5),
      p95: percentileFromBuckets(b.histogram, 0.95),
      p99: percentileFromBuckets(b.histogram, 0.99),
    });
  }
  return { series, overall };
}

export async function queryAnalyticsOverview(
  /** null = install-wide (caller has authorized install scope). */
  hosts: string[] | null,
  range: AnalyticsRange,
  geoConfigured: boolean,
  nowMs = Date.now(),
): Promise<{
  series: SeriesBucket[];
  bucketSeconds: number;
  summary: AnalyticsSummary;
  flags: AnalyticsFlags;
}> {
  const spec = RANGES[range];
  const fromMs = nowMs - spec.windowMs;
  const live = snapshotAccumulators();
  const dayKeys = coveringDayKeys(fromMs, nowMs);
  const { rows: dayRows, usedLive: liveDay } = await mergedDayRows(hosts, dayKeys, live.days);

  let buckets: Map<number, InternalBucket>;
  let usedLiveMinute = false;
  if (spec.bucketMinutes === "day") {
    buckets = new Map();
    foldDayRowsIntoBuckets(buckets, dayRows);
  } else {
    buckets = await loadMinuteBuckets(hosts, Math.floor(fromMs / 60_000), spec.bucketMinutes);
    usedLiveMinute = foldLiveMinutesIntoBuckets(
      buckets,
      live.minutes,
      hosts === null ? null : new Set(hosts),
      fromMs,
      spec.bucketMinutes * 60_000,
    );
  }

  const bucketSeconds = spec.bucketMinutes === "day" ? 86_400 : spec.bucketMinutes * 60;
  const { series, overall } = buildSeries(buckets, fromMs, nowMs, bucketSeconds * 1000);

  // Visitors are day-granular regardless of range: sum of per-day distinct as
  // the labeled upper bound, largest single day as the exact lower bound.
  let visitorDays = 0;
  let peakDayVisitors = 0;
  let approximate = false;
  for (const row of dayRows) {
    visitorDays += row.visitors;
    if (row.visitors > peakDayVisitors) peakDayVisitors = row.visitors;
    if (row.approximate) approximate = true;
  }

  const errors = overall.s4xx + overall.s5xx;
  return {
    series,
    bucketSeconds,
    summary: {
      requests: overall.requests,
      botRequests: overall.botRequests,
      visitorDays,
      peakDayVisitors,
      bytesOut: overall.resBytes,
      avgLatencyMs:
        overall.requests > 0 ? Math.round(overall.latencySumMs / overall.requests) : null,
      p50: percentileFromBuckets(overall.histogram, 0.5),
      p95: percentileFromBuckets(overall.histogram, 0.95),
      p99: percentileFromBuckets(overall.histogram, 0.99),
      errorRate: overall.requests > 0 ? errors / overall.requests : 0,
      // Install-wide has no scope list: count the hosts actually seen in the
      // window instead, so the "no public domains" empty state never fires.
      hostCount: hosts === null ? new Set(dayRows.map((r) => r.host)).size : hosts.length,
    },
    flags: {
      approximate,
      source: usedLiveMinute || liveDay ? "rollup+live" : "rollup",
      geoAvailable: geoConfigured,
    },
  };
}

function topN(merged: Record<string, number>, n: number): TopEntry[] {
  const entries = Object.entries(merged)
    .filter(([key]) => key !== OVERFLOW_KEY)
    .sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, n).map(([key, count]) => ({ key, count }));
  let other = merged[OVERFLOW_KEY] ?? 0;
  for (const [, count] of entries.slice(n)) other += count;
  if (other > 0) top.push({ key: "other", count: other });
  return top;
}

const DIM_NAMES = [
  "statuses",
  "paths",
  "referrers",
  "countries",
  "browsers",
  "oses",
  "deviceTypes",
] as const;
type DimName = (typeof DIM_NAMES)[number];

export async function queryAnalyticsBreakdowns(
  /** null = install-wide (caller has authorized install scope). */
  hosts: string[] | null,
  range: AnalyticsRange,
  geoConfigured: boolean,
  nowMs = Date.now(),
): Promise<{ breakdowns: AnalyticsBreakdowns; flags: AnalyticsFlags }> {
  const spec = RANGES[range];
  const fromMs = nowMs - spec.windowMs;
  const dayKeys = coveringDayKeys(fromMs, nowMs);
  const live = snapshotAccumulators();
  const { rows, usedLive } = await mergedDayRows(hosts, dayKeys, live.days);

  const dims: Record<DimName, Record<string, number>> = {
    statuses: {},
    paths: {},
    referrers: {},
    countries: {},
    browsers: {},
    oses: {},
    deviceTypes: {},
  };
  let approximate = false;
  for (const row of rows) {
    if (row.approximate) approximate = true;
    for (const name of DIM_NAMES) {
      const target = dims[name];
      for (const [key, count] of Object.entries(row[name])) {
        target[key] = (target[key] ?? 0) + count;
      }
    }
  }

  return {
    breakdowns: {
      statuses: topN(dims.statuses, TOP_N),
      paths: topN(dims.paths, TOP_N),
      referrers: topN(dims.referrers, TOP_N),
      countries: topN(dims.countries, TOP_N),
      browsers: topN(dims.browsers, TOP_N),
      oses: topN(dims.oses, TOP_N),
      deviceTypes: topN(dims.deviceTypes, TOP_N),
      breakdownDays: dayKeys.length,
    },
    flags: {
      approximate,
      source: usedLive ? "rollup+live" : "rollup",
      geoAvailable: geoConfigured,
    },
  };
}
