/**
 * The overview's metric vocabulary: what each stat tile reads from the totals,
 * how it formats, which chart series (if any) carries it over time, and how a
 * period-over-period delta is judged. Pure — the tiles and the hero chart are
 * thin renderings of this table.
 */

import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";

import { formatCount } from "../analytics-model";
import { formatDurationMs } from "./format-duration";

export interface OverviewTotals {
  visitors: number;
  pageviews: number;
  sessions: number;
  bounceRate: number | null;
  avgDurationMs: number | null;
  viewsPerVisit: number | null;
  conversions: number;
}

export const OVERVIEW_METRICS = [
  "visitors",
  "pageviews",
  "sessions",
  "bounceRate",
  "avgDuration",
  "viewsPerVisit",
] as const;

export type OverviewMetricKey = (typeof OVERVIEW_METRICS)[number];

/** The five tiles, in reading order. `sessions` stays URL-selectable but has
 *  no tile: five tiles is the row the grid is designed around. */
export const TILE_METRICS = [
  "visitors",
  "pageviews",
  "bounceRate",
  "avgDuration",
  "viewsPerVisit",
] as const satisfies readonly OverviewMetricKey[];

type SeriesKey = "visitors" | "pageviews" | "sessions";

/** Literal so `t()` can type-check the key against the bundle. */
type MetricLabelKey =
  | "analytics.overview.visitors"
  | "analytics.overview.pageviews"
  | "analytics.overview.sessions"
  | "analytics.overview.bounceRate"
  | "analytics.overview.avgVisit"
  | "analytics.overview.viewsPerVisit";

interface MetricDef {
  labelKey: MetricLabelKey;
  /** Which per-bucket series charts this metric; null = totals-only (the
   *  chart falls back to visitors and says so, never fabricates a series). */
  seriesKey: SeriesKey | null;
  /** A falling reading is the good direction (bounce rate). */
  goodWhenDown: boolean;
  read: (totals: OverviewTotals) => number | null;
  format: (value: number) => string;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const ratio = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

export const METRIC_DEFS: Record<OverviewMetricKey, MetricDef> = {
  visitors: {
    labelKey: "analytics.overview.visitors",
    seriesKey: "visitors",
    goodWhenDown: false,
    read: (t) => t.visitors,
    format: formatCount,
  },
  pageviews: {
    labelKey: "analytics.overview.pageviews",
    seriesKey: "pageviews",
    goodWhenDown: false,
    read: (t) => t.pageviews,
    format: formatCount,
  },
  sessions: {
    labelKey: "analytics.overview.sessions",
    seriesKey: "sessions",
    goodWhenDown: false,
    read: (t) => t.sessions,
    format: formatCount,
  },
  bounceRate: {
    labelKey: "analytics.overview.bounceRate",
    seriesKey: null,
    goodWhenDown: true,
    read: (t) => t.bounceRate,
    format: percent,
  },
  avgDuration: {
    labelKey: "analytics.overview.avgVisit",
    seriesKey: null,
    goodWhenDown: false,
    read: (t) => t.avgDurationMs,
    format: formatDurationMs,
  },
  viewsPerVisit: {
    labelKey: "analytics.overview.viewsPerVisit",
    seriesKey: null,
    goodWhenDown: false,
    read: (t) => t.viewsPerVisit,
    format: ratio,
  },
};

// ─── Deltas ────────────────────────────────────────────────────────────────

export type DeltaTone = "up" | "down" | "flat";

export interface Delta {
  /** "↑ 12%", "↓ 4%", "±0%". */
  text: string;
  tone: DeltaTone;
  /** Whether the movement is welcome — drives success/destructive colour. */
  good: boolean;
}

/**
 * Period-over-period delta. Null when either period has no reading or the
 * previous period is zero (an infinite percent is not a fact). Under 0.5%
 * movement reads as flat: a tile flickering ↑1% ↓1% on every poll is noise.
 */
export function metricDelta(
  current: number | null,
  previous: number | null,
  goodWhenDown: boolean,
): Delta | null {
  if (current === null || previous === null || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.5) return { text: "±0%", tone: "flat", good: true };
  const rounded = Math.round(Math.abs(pct));
  if (pct > 0) return { text: `↑ ${rounded}%`, tone: "up", good: !goodWhenDown };
  return { text: `↓ ${rounded}%`, tone: "down", good: goodWhenDown };
}

// ─── Series → chart rows ───────────────────────────────────────────────────

export interface SeriesBucket {
  t: string;
  visitors: number;
  pageviews: number;
  sessions: number;
}

export interface ChartRow {
  ts: number;
  value: number;
}

/** Wire buckets → chart rows for one series key. A bucket whose timestamp
 *  fails to parse is dropped, never guessed. */
export function toChartRows(series: readonly SeriesBucket[], key: SeriesKey): ChartRow[] {
  const rows: ChartRow[] = [];
  for (const bucket of series) {
    const ts = Result.try(() => Temporal.Instant.from(bucket.t).epochMilliseconds).unwrapOr(null);
    if (ts === null) continue;
    rows.push({ ts, value: bucket[key] });
  }
  return rows;
}

/** Expected bucket spacing, for the chart's gap detection. Months vary
 *  28–31 days; 31 keeps a legitimate January–February step from reading as
 *  an outage. */
export function bucketIntervalMs(bucket: "hour" | "day" | "week" | "month"): number {
  const HOUR = 3_600_000;
  switch (bucket) {
    case "hour":
      return HOUR;
    case "day":
      return 24 * HOUR;
    case "week":
      return 7 * 24 * HOUR;
    case "month":
      return 31 * 24 * HOUR;
  }
}
