/**
 * The five stat tiles. Each is a button that promotes its metric to the hero
 * chart; the selected tile carries a 2px accent bar inside the ring — the
 * accent's one appearance outside the chart line. Deltas judge against the
 * comparison period and know that a falling bounce rate is good news.
 */

import { useTranslation } from "react-i18next";

import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

import {
  METRIC_DEFS,
  metricDelta,
  type OverviewMetricKey,
  type OverviewTotals,
  TILE_METRICS,
} from "../../lib/overview-metrics";

export function StatTiles({
  totals,
  previous,
  selected,
  onSelect,
  loading,
}: {
  totals: OverviewTotals | undefined;
  previous: OverviewTotals | null | undefined;
  selected: OverviewMetricKey;
  onSelect: (metric: OverviewMetricKey) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {TILE_METRICS.map((key) => (
        <StatTile
          key={key}
          metric={key}
          label={t(METRIC_DEFS[key].labelKey)}
          totals={totals}
          previous={previous}
          selected={selected === key}
          onSelect={() => onSelect(key)}
          loading={loading}
        />
      ))}
    </div>
  );
}

function StatTile({
  metric,
  label,
  totals,
  previous,
  selected,
  onSelect,
  loading,
}: {
  metric: OverviewMetricKey;
  label: string;
  totals: OverviewTotals | undefined;
  previous: OverviewTotals | null | undefined;
  selected: boolean;
  onSelect: () => void;
  loading: boolean;
}) {
  const def = METRIC_DEFS[metric];
  const reading = totals ? def.read(totals) : null;
  const delta =
    totals && previous ? metricDelta(def.read(totals), def.read(previous), def.goodWhenDown) : null;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "relative flex flex-col items-start gap-1 overflow-hidden rounded-lg bg-card px-3.5 py-3 text-left ring-1 ring-foreground/10 transition-all",
        "hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px",
      )}
    >
      {/* Selection marker: a hairline of the accent along the top, inside
          the ring — never a filled tile. */}
      {selected ? (
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
      ) : null}
      <span className="text-xs text-muted-foreground">{label}</span>
      {loading || totals === undefined ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <span className="font-mono text-2xl leading-7 font-medium tabular-nums">
          {reading === null ? "–" : def.format(reading)}
        </span>
      )}
      {delta ? (
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            delta.tone === "flat"
              ? "text-muted-foreground"
              : delta.good
                ? "text-success"
                : "text-destructive",
          )}
        >
          {delta.text}
        </span>
      ) : (
        // Reserve the line so tiles keep one height whether or not a delta
        // exists; an empty slot is honest, a phantom ±0% is not.
        <span aria-hidden="true" className="text-[11px]">
          &nbsp;
        </span>
      )}
    </button>
  );
}
