/**
 * Shared vocabulary of the analytics readers: range table, output shapes,
 * and the merged day-row loader both the overview and the breakdowns build
 * on. Day rows carry the day-granular dimensions (visitors, countries,
 * paths…), so both readers need the same DB-plus-live-replace merge.
 */

import { db } from "@otterdeploy/db";
import { edgeStatDay } from "@otterdeploy/db/schema/edge-stat";
import { and, inArray } from "drizzle-orm";

import type { DayAcc } from "./analytics-fold";

import { dayKey } from "./analytics-normalize";

export type AnalyticsRange = "24h" | "7d" | "30d" | "90d";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const RANGES: Record<AnalyticsRange, number> = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "90d": 90 * DAY_MS,
};

export interface ResolvedWindow {
  fromMs: number;
  toMs: number;
  bucketMinutes: number | "day";
}

/** Bucket granularity from span: ~100 buckets for short windows, hours for a
 *  week-scale one, whole days past two weeks (day rows are the cheap store). */
function bucketMinutesFor(spanMs: number): number | "day" {
  if (spanMs <= 48 * HOUR_MS) return 15;
  if (spanMs <= 14 * DAY_MS) return 60;
  return "day";
}

/**
 * A preset window ends NOW; a custom `from`/`to` pair (epoch ms, validated at
 * the contract) wins over the preset and may end anywhere in the past.
 */
export function resolveAnalyticsWindow(
  range: AnalyticsRange,
  fromMs: number | undefined,
  toMs: number | undefined,
  nowMs: number,
): ResolvedWindow {
  if (fromMs !== undefined && toMs !== undefined) {
    return { fromMs, toMs, bucketMinutes: bucketMinutesFor(toMs - fromMs) };
  }
  const spanMs = RANGES[range];
  return { fromMs: nowMs - spanMs, toMs: nowMs, bucketMinutes: bucketMinutesFor(spanMs) };
}

export interface SeriesBucket {
  t: string;
  requests: number;
  botRequests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  sOther: number;
  resBytes: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface AnalyticsSummary {
  requests: number;
  botRequests: number;
  /** Sum of per-day distinct visitors: the honest upper bound. Per-day counts
   *  cannot be combined into a window-distinct figure. */
  visitorDays: number;
  /** Largest single day: the exact lower bound. */
  peakDayVisitors: number;
  bytesOut: number;
  avgLatencyMs: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  /** 4xx+5xx over total, 0..1. */
  errorRate: number;
  hostCount: number;
}

export interface AnalyticsFlags {
  approximate: boolean;
  source: "rollup" | "rollup+live";
  geoAvailable: boolean;
}

export interface TopEntry {
  key: string;
  count: number;
}

export interface AnalyticsBreakdowns {
  hosts: TopEntry[];
  statuses: TopEntry[];
  paths: TopEntry[];
  referrers: TopEntry[];
  countries: TopEntry[];
  browsers: TopEntry[];
  oses: TopEntry[];
  deviceTypes: TopEntry[];
  breakdownDays: number;
}

/** UTC days whose rows can intersect [fromMs, now]. */
export function coveringDayKeys(fromMs: number, nowMs: number): string[] {
  const keys: string[] = [];
  let ms = fromMs;
  const last = dayKey(nowMs);
  for (;;) {
    const key = dayKey(ms);
    keys.push(key);
    if (key === last) break;
    ms += DAY_MS;
  }
  return keys;
}

/** Day rows for the window with today's (and any matching) live accumulators
 *  REPLACING their DB counterparts: day accs are running totals seeded from
 *  the DB, so adding would roughly double today. `hosts: null` means
 *  install-wide: no host filter at all (the caller has already authorized
 *  install scope). The returned rows may be live acc objects: read-only. */
export async function mergedDayRows(
  hosts: string[] | null,
  dayKeys: string[],
  live: DayAcc[],
): Promise<{ rows: DayAcc[]; usedLive: boolean }> {
  const dbRows =
    hosts !== null && hosts.length === 0
      ? []
      : await db
          .select()
          .from(edgeStatDay)
          .where(
            hosts === null
              ? inArray(edgeStatDay.day, dayKeys)
              : and(inArray(edgeStatDay.host, hosts), inArray(edgeStatDay.day, dayKeys)),
          );
  const hostSet = hosts === null ? null : new Set(hosts);
  const daySet = new Set(dayKeys);
  const byKey = new Map<string, DayAcc>();
  for (const row of dbRows) byKey.set(`${row.host}|${row.day}`, row);
  let usedLive = false;
  for (const acc of live) {
    if ((hostSet !== null && !hostSet.has(acc.host)) || !daySet.has(acc.day)) continue;
    byKey.set(`${acc.host}|${acc.day}`, acc);
    usedLive = true;
  }
  return { rows: [...byKey.values()], usedLive };
}
