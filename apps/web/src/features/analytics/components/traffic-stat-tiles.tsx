/**
 * The Traffic tab's five stat tiles, in the Overview tile's vocabulary:
 * sentence-case label, mono reading, a delta chip judged against the previous
 * window (latency and errors know that down is good), and a grey sparkline
 * along the bottom for the shape. Not buttons: this plane has no hero-metric
 * selection.
 */

import { useTranslation } from "react-i18next";

import { TimeSeriesChart } from "@/shared/components/charts/time-series-chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

import type { TileSub, TrafficTile, TrafficTileKey } from "./analytics-view-parts";

const SPARK_HEIGHT = 28;

const LABEL_KEYS = {
  requests: "analytics.traffic.requests",
  visitorDays: "analytics.traffic.visitorDays",
  bandwidth: "analytics.traffic.bandwidthOut",
  latency: "analytics.traffic.latencyP95",
  errorRate: "analytics.traffic.errorRate",
} as const satisfies Record<TrafficTileKey, string>;

const HELP_KEYS = {
  visitorDays: "analytics.traffic.visitorDaysHelp",
  latency: "analytics.traffic.latencyHelp",
} as const;

export function TrafficStatTiles({
  tiles,
  bucketMs,
}: {
  tiles: readonly TrafficTile[];
  /** Expected ms between series buckets, for the sparkline's gap detection. */
  bucketMs: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <StatTile key={tile.key} tile={tile} bucketMs={bucketMs} />
      ))}
    </div>
  );
}

function StatTile({ tile, bucketMs }: { tile: TrafficTile; bucketMs: number }) {
  const { t } = useTranslation();
  const label = t(LABEL_KEYS[tile.key]);
  return (
    <div className="flex flex-col gap-1 overflow-hidden rounded-lg bg-card px-3.5 pt-3 ring-1 ring-foreground/10">
      {tile.help ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="w-fit cursor-help text-xs text-muted-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-2" />
            }
          >
            {label}
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{t(HELP_KEYS[tile.help])}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      <span className="font-mono text-2xl leading-7 font-medium tabular-nums">{tile.value}</span>
      <span className="flex min-h-4 items-baseline gap-2 text-[11px]">
        {tile.delta ? (
          <span
            className={cn(
              "font-mono tabular-nums",
              tile.delta.tone === "flat"
                ? "text-muted-foreground"
                : tile.delta.good
                  ? "text-success"
                  : "text-destructive",
            )}
          >
            {tile.delta.text}
          </span>
        ) : null}
        {tile.sub ? (
          <span className="truncate font-mono text-muted-foreground tabular-nums">
            <SubText sub={tile.sub} />
          </span>
        ) : null}
      </span>
      {/* The spark bleeds to the tile's edges: it is the tile's floor, not a
          figure inside it. A tile without one reserves the height so the row
          keeps one baseline. */}
      <div className="-mx-3.5 mt-1" style={{ height: SPARK_HEIGHT }}>
        {tile.spark && tile.spark.length > 1 ? (
          <TimeSeriesChart
            data={tile.spark}
            series={[{ dataKey: "value", label, color: "var(--chart-3)" }]}
            format={String}
            ariaLabel={label}
            compact
            height={SPARK_HEIGHT}
            sampleIntervalMs={bucketMs}
          />
        ) : null}
      </div>
    </div>
  );
}

function SubText({ sub }: { sub: TileSub }) {
  const { t } = useTranslation();
  switch (sub.kind) {
    case "bots":
      return t("analytics.traffic.subBots", { share: sub.share });
    case "peakDay":
      return t("analytics.traffic.subPeakDay", { count: sub.count });
    case "avg":
      return t("analytics.traffic.subAvg", { ms: sub.ms });
    case "errorClasses":
      return t("analytics.traffic.errorClasses");
  }
}
