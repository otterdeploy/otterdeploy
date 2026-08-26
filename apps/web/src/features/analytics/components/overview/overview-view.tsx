/**
 * The Overview view: nudge → filter bar → stat tiles → hero chart →
 * breakdown grid → the honesty footer. Layout and wiring only; every number
 * on screen is read from one overview query so the tiles, chart and live
 * badge can never disagree.
 */

import type { FilterDimension } from "@otterdeploy/shared/analytics-filters";

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Temporal } from "@otterdeploy/shared/temporal";
import { useTranslation } from "react-i18next";

import { LiveIndicator } from "@/features/resources/components/_shared/metrics/metrics-tab-chrome";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

import {
  type AnalyticsScope,
  type AnalyticsWindowState,
  BROWSER_TZ,
  useOverview,
} from "../../hooks/use-web-analytics";
import { type WebAnalyticsFilter, withFilter } from "../../lib/filter-codec";
import { formatAgo } from "../../lib/format-duration";
import { type OverviewMetricKey } from "../../lib/overview-metrics";
import { FilterBar } from "../filter-bar";
import { BreakdownGrid } from "./breakdown-grid";
import { HeroChart } from "./hero-chart";
import { type NudgeProject, SetupNudge } from "./setup-nudge";
import { StatTiles } from "./stat-tiles";

export function OverviewView({
  scope,
  win,
  project,
  projects,
  metric,
  onMetricChange,
  onFiltersChange,
  onGoSetup,
  onShowRealtime,
  onShowEvents,
}: {
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  project: NudgeProject | undefined;
  projects: readonly NudgeProject[];
  metric: OverviewMetricKey;
  onMetricChange: (next: OverviewMetricKey) => void;
  onFiltersChange: (next: WebAnalyticsFilter[]) => void;
  onGoSetup: (projectSlug: string) => void;
  onShowRealtime: () => void;
  onShowEvents: () => void;
}) {
  const { t } = useTranslation();
  const overview = useOverview(scope, win);

  const addFilter = (dim: FilterDimension, key: string) =>
    onFiltersChange(withFilter(win.filters, { dim, op: "is", value: key }));

  if (overview.isError) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>{t("analytics.overview.errorTitle")}</EmptyTitle>
          <EmptyDescription>{t("analytics.overview.errorBody")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const nowMs = Temporal.Now.instant().epochMilliseconds;

  return (
    <div className="flex flex-col gap-4">
      <SetupNudge project={project} projects={projects} onGoSetup={onGoSetup} />

      <FilterBar scope={scope} win={win} filters={win.filters} onFiltersChange={onFiltersChange} />

      <StatTiles
        totals={overview.data?.totals}
        previous={overview.data?.previous}
        selected={metric}
        onSelect={onMetricChange}
        loading={overview.isPending}
      />

      <HeroChart
        metric={metric}
        totals={overview.data?.totals}
        series={overview.data?.series}
        bucket={overview.data?.bucket}
        loading={overview.isPending}
      />

      <BreakdownGrid
        scope={scope}
        win={win}
        onAddFilter={addFilter}
        onShowRealtime={onShowRealtime}
        onShowEvents={onShowEvents}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-xs text-muted-foreground">
          {t("analytics.overview.footerTimes", { tz: BROWSER_TZ })}
          {overview.dataUpdatedAt > 0
            ? ` · ${t("analytics.overview.footerUpdated", {
                ago: formatAgo(nowMs - overview.dataUpdatedAt),
              })}`
            : ""}
          {" · "}
          {t("analytics.overview.footerSource")}
        </p>
        {overview.dataUpdatedAt > 0 && nowMs - overview.dataUpdatedAt < 90_000 ? (
          <LiveIndicator updatedAt={overview.dataUpdatedAt} />
        ) : null}
      </div>
    </div>
  );
}
