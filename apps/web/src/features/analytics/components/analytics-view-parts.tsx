/**
 * Presentational pieces of the Traffic tab: the headline-tile derivation
 * (pure, table-testable), and the small chrome around the dashboard (host
 * chip, honesty notes, skeleton, error). Split from analytics-view.tsx so the
 * view stays the small orchestrator over the two queries.
 */

import { Alert02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { formatBytes } from "@/features/resources/components/_shared/metrics/format";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";

import { formatCount, formatShare } from "../analytics-model";
import { isoMs } from "../lib/iso-ms";
import { type ChartRow, type Delta, metricDelta } from "../lib/overview-metrics";

export interface OverviewSummary {
  requests: number;
  botRequests: number;
  visitorDays: number;
  peakDayVisitors: number;
  bytesOut: number;
  avgLatencyMs: number | null;
  p95: number | null;
  errorRate: number;
  hostCount: number;
}

interface SparkBucket {
  t: string;
  requests: number;
  s4xx: number;
  s5xx: number;
  resBytes: number;
  p95: number | null;
}

export interface PreviousTotals {
  requests: number;
  visitorDays: number;
  bytesOut: number;
  p95: number | null;
  errorRate: number;
}

export type TrafficTileKey = "requests" | "visitorDays" | "bandwidth" | "latency" | "errorRate";

/** The muted qualifier under a value, as data: the tile translates it. */
export type TileSub =
  | { kind: "bots"; share: string }
  | { kind: "peakDay"; count: string }
  | { kind: "avg"; ms: number }
  | { kind: "errorClasses" };

export interface TrafficTile {
  key: TrafficTileKey;
  value: string;
  sub?: TileSub;
  /** Labels that carry semantics ("visitor-days") explain themselves on hover. */
  help?: "visitorDays" | "latency";
  /** Per-bucket shape over the window; omitted = no spark. */
  spark?: ChartRow[];
  delta: Delta | null;
}

/** Wire buckets → sparkline rows; a null reading is a break, never a zero. */
function sparkRows(series: readonly SparkBucket[], pick: (b: SparkBucket) => number | null) {
  const rows: ChartRow[] = [];
  for (const bucket of series) {
    const ts = isoMs(bucket.t);
    const value = pick(bucket);
    if (ts === null || value === null) continue;
    rows.push({ ts, value });
  }
  return rows;
}

function formatErrorRate(rate: number): string {
  return `${(rate * 100).toFixed(rate < 0.01 ? 2 : 1)}%`;
}

/**
 * The five headline tiles.
 *
 * `measuring: false` blanks every value to an em dash instead of rendering
 * zeros. This is not cosmetic. A tile reading "0 requests / 0.0% errors" is a
 * measurement claim, and when nothing is being recorded no measurement was
 * taken — the honest answer is "we don't know", not "none". Zero is only
 * truthful once collection is actually running, which is exactly the
 * distinction analytics-query.ts already draws for its zero-filled series
 * ("0 requests is a real measurement, a gap is not").
 */
export function trafficTiles(
  summary: OverviewSummary,
  series: readonly SparkBucket[],
  previous: PreviousTotals,
  measuring = true,
): TrafficTile[] {
  const tiles: TrafficTile[] = [
    {
      key: "requests",
      value: formatCount(summary.requests),
      sub:
        summary.requests > 0
          ? { kind: "bots", share: formatShare(summary.botRequests, summary.requests) }
          : undefined,
      spark: sparkRows(series, (b) => b.requests),
      delta: metricDelta(summary.requests, previous.requests, false),
    },
    {
      key: "visitorDays",
      value: formatCount(summary.visitorDays),
      sub:
        summary.peakDayVisitors > 0
          ? { kind: "peakDay", count: formatCount(summary.peakDayVisitors) }
          : undefined,
      help: "visitorDays",
      delta: metricDelta(summary.visitorDays, previous.visitorDays, false),
    },
    {
      key: "bandwidth",
      value: formatBytes(summary.bytesOut),
      spark: sparkRows(series, (b) => b.resBytes),
      delta: metricDelta(summary.bytesOut, previous.bytesOut, false),
    },
    {
      key: "latency",
      value: summary.p95 === null ? "–" : `${summary.p95} ms`,
      sub: summary.avgLatencyMs === null ? undefined : { kind: "avg", ms: summary.avgLatencyMs },
      help: "latency",
      spark: sparkRows(series, (b) => b.p95),
      delta: metricDelta(summary.p95, previous.p95, true),
    },
    {
      key: "errorRate",
      value: formatErrorRate(summary.errorRate),
      sub: { kind: "errorClasses" },
      spark: sparkRows(series, (b) => b.s4xx + b.s5xx),
      delta: metricDelta(summary.errorRate, previous.errorRate, true),
    },
  ];

  if (measuring) return tiles;
  // Keep the labels and the layout: the operator should still see WHAT this
  // page reports, just not a number the install never took.
  return tiles.map((tile) => ({ key: tile.key, value: "–", help: tile.help, delta: null }));
}

// ─── Chrome ────────────────────────────────────────────────────────────────

/** The applied single-domain filter, in the filter bar's chip idiom. */
export function HostFilterChip({ host, onClear }: { host: string; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted py-0 pr-1 pl-2.5 text-xs">
        <span className="text-muted-foreground">
          {t("analytics.filters.dims.host")} {t("analytics.filters.is").toLowerCase()}
        </span>
        <span className="max-w-64 truncate font-mono">{host}</span>
        <button
          type="button"
          aria-label={t("analytics.traffic.clearHostFilter")}
          onClick={onClear}
          className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
        </button>
      </span>
    </div>
  );
}

export function HonestyNotes({
  approximate,
  breakdownDays,
  shortWindow,
}: {
  approximate: boolean;
  breakdownDays: number | undefined;
  /** Sub-day buckets: the day-granular breakdowns cover more than the series. */
  shortWindow: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-0.5">
      {approximate ? (
        <p className="text-xs text-muted-foreground">{t("analytics.traffic.approximate")}</p>
      ) : null}
      {shortWindow && breakdownDays !== undefined ? (
        <p className="text-xs text-muted-foreground">
          {t("analytics.traffic.breakdownDays", { count: breakdownDays })}
        </p>
      ) : null}
    </div>
  );
}

/** Centred one-liner inside a chart card whose series is empty. */
export function QuietNote({ children }: { children: string }) {
  return (
    <p className="flex h-32 items-center justify-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** Skeleton in the shape of the loaded page: tiles, chart, grid. */
export function TrafficSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[22.5rem] w-full rounded-lg" />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-64 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function TrafficError() {
  const { t } = useTranslation();
  return (
    <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
      <EmptyHeader>
        <HugeiconsIcon
          icon={Alert02Icon}
          strokeWidth={1.5}
          className="size-10 text-muted-foreground/50"
        />
        <EmptyTitle>{t("analytics.traffic.errorTitle")}</EmptyTitle>
        <EmptyDescription>{t("analytics.traffic.errorBody")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
