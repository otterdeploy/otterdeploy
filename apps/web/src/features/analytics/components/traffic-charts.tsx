/**
 * The Traffic tab's two charts. Requests is the plane's one primary series,
 * so it takes the grey ramp; the 4xx+5xx line on top is state, in the
 * destructive hue. Percentiles share an axis but not a baseline, so they
 * draw as lines: three overlapping fills would read as one quantity rather
 * than three readings. The ramp runs light-to-dark with the percentile, so
 * the tail is the darkest line on the chart.
 */

import { useMemo } from "react";

import { useTranslation } from "react-i18next";

import { MetricCard } from "@/features/resources/components/_shared/metrics/metric-card";
import { TimeSeriesChart } from "@/shared/components/charts/time-series-chart";

import { formatCount } from "../analytics-model";
import { isoMs } from "../lib/iso-ms";
import { QuietNote } from "./analytics-view-parts";

const REQUESTS_HEIGHT = 280;
const LATENCY_HEIGHT = 200;

interface WireBucket {
  t: string;
  requests: number;
  s4xx: number;
  s5xx: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

interface RequestRow {
  ts: number;
  requests: number;
  errors: number;
}

interface LatencyRow {
  ts: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

/** Wide rows straight off the wire: the chart folds them per series itself.
 *  A bucket whose timestamp fails to parse is dropped, never guessed. */
function toRows(series: readonly WireBucket[]): { requests: RequestRow[]; latency: LatencyRow[] } {
  const requests: RequestRow[] = [];
  const latency: LatencyRow[] = [];
  for (const b of series) {
    const ts = isoMs(b.t);
    if (ts === null) continue;
    requests.push({ ts, requests: b.requests, errors: b.s4xx + b.s5xx });
    latency.push({ ts, p50: b.p50, p95: b.p95, p99: b.p99 });
  }
  return { requests, latency };
}

export function TrafficCharts({
  series,
  bucketMs,
  totalRequests,
  p95,
  avgLatencyMs,
}: {
  series: readonly WireBucket[];
  /** Expected ms between buckets: a longer gap draws as a break. */
  bucketMs: number;
  totalRequests: number;
  p95: number | null;
  avgLatencyMs: number | null;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => toRows(series), [series]);

  return (
    <>
      <MetricCard title={t("analytics.traffic.requests")} value={formatCount(totalRequests)}>
        {totalRequests === 0 ? (
          <QuietNote>{t("analytics.traffic.noRequests")}</QuietNote>
        ) : (
          <TimeSeriesChart
            data={rows.requests}
            ariaLabel={t("analytics.traffic.requestsAria")}
            format={formatCount}
            height={REQUESTS_HEIGHT}
            sampleIntervalMs={bucketMs}
            series={[
              {
                dataKey: "requests",
                label: t("analytics.traffic.requests"),
                color: "var(--chart-3)",
              },
              {
                dataKey: "errors",
                label: t("analytics.traffic.errorClasses"),
                color: "var(--destructive)",
              },
            ]}
          />
        )}
      </MetricCard>

      <MetricCard
        title={t("analytics.traffic.latency")}
        value={p95 === null ? "–" : `${p95} ms`}
        stats={avgLatencyMs === null ? undefined : [{ label: "avg", value: `${avgLatencyMs} ms` }]}
      >
        {p95 === null ? (
          <QuietNote>{t("analytics.traffic.noRequests")}</QuietNote>
        ) : (
          <TimeSeriesChart
            data={rows.latency}
            ariaLabel={t("analytics.traffic.latencyAria")}
            format={(v) => `${Math.round(v)} ms`}
            height={LATENCY_HEIGHT}
            kind="line"
            sampleIntervalMs={bucketMs}
            series={[
              { dataKey: "p99", label: "p99", color: "var(--chart-5)" },
              { dataKey: "p95", label: "p95", color: "var(--chart-3)" },
              { dataKey: "p50", label: "p50", color: "var(--chart-1)" },
            ]}
          />
        )}
      </MetricCard>
    </>
  );
}
