/**
 * The hero chart: the selected metric over the window, drawn in the accent —
 * the one place on the page the accent is a line, per the budget. Totals-only
 * metrics (bounce, duration, views/visit) have no per-bucket series; the
 * chart then keeps showing visitors and says so in a caption rather than
 * fabricating a curve the API never sent.
 */

import { useTranslation } from "react-i18next";

import { MetricCard } from "@/features/resources/components/_shared/metrics/metric-card";
import { TimeSeriesChart } from "@/shared/components/charts/time-series-chart";
import { Skeleton } from "@/shared/components/ui/skeleton";

import {
  bucketIntervalMs,
  METRIC_DEFS,
  type OverviewMetricKey,
  type OverviewTotals,
  type SeriesBucket,
  toChartRows,
} from "../../lib/overview-metrics";

const HERO_HEIGHT = 280;

export function HeroChart({
  metric,
  totals,
  series,
  bucket,
  loading,
}: {
  metric: OverviewMetricKey;
  totals: OverviewTotals | undefined;
  series: readonly SeriesBucket[] | undefined;
  bucket: "hour" | "day" | "week" | "month" | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const def = METRIC_DEFS[metric];
  // Fall back to visitors for totals-only metrics; the caption below owns
  // the honesty of that substitution.
  const chartedKey = def.seriesKey ?? "visitors";
  const chartedDef = def.seriesKey ? def : METRIC_DEFS.visitors;
  const rows = series ? toChartRows(series, chartedKey) : [];
  const reading = totals ? def.read(totals) : null;

  if (loading || series === undefined || bucket === undefined) {
    return <Skeleton className="h-[22.5rem] w-full rounded-lg" />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <MetricCard
        title={t(def.labelKey)}
        swatch="var(--primary)"
        value={reading === null ? "–" : def.format(reading)}
      >
        <TimeSeriesChart
          data={rows}
          series={[{ dataKey: "value", label: t(chartedDef.labelKey), color: "var(--primary)" }]}
          format={(value) => chartedDef.format(value)}
          ariaLabel={t("analytics.overview.chartAria", { metric: t(chartedDef.labelKey) })}
          height={HERO_HEIGHT}
          kind="area"
          sampleIntervalMs={bucketIntervalMs(bucket)}
        />
      </MetricCard>
      {def.seriesKey === null ? (
        <p className="px-1 text-xs text-muted-foreground">
          {t("analytics.overview.noSeries", { metric: t(def.labelKey) })}
        </p>
      ) : null}
    </div>
  );
}
