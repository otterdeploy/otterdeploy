/**
 * The overview's breakdown grid: six cards on one shared shell. Every card
 * owns its dimension switcher locally (which page/source facet you're reading
 * is a lens, not shareable state) while row clicks write real filters into
 * the URL through the parent.
 */

import type { BreakdownDimension, FilterDimension } from "@otterdeploy/shared/analytics-filters";

import { useState } from "react";

import { useTranslation } from "react-i18next";

import { countryName, formatCount } from "../../analytics-model";
import {
  type AnalyticsScope,
  type AnalyticsWindowState,
  useBreakdown,
} from "../../hooks/use-web-analytics";
import { BreakdownCard, type DimensionOption } from "./breakdown-card";
import { isMonoDimension, leadingFor } from "./dimension-leading";
import { ListMapToggle, type LocationsMode } from "./list-map-toggle";
import { LocationsMap } from "./locations-map";
import { OverviewSeeAll, type SeeAllTarget } from "./overview-see-all";
import { RealtimeMiniCard } from "./realtime-mini-card";

const CARD_LIMIT = 6;

export function BreakdownGrid({
  scope,
  win,
  onAddFilter,
  onShowRealtime,
  onShowEvents,
}: {
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  onAddFilter: (dim: FilterDimension, key: string) => void;
  onShowRealtime: () => void;
  onShowEvents: () => void;
}) {
  const { t } = useTranslation();
  const [seeAll, setSeeAll] = useState<SeeAllTarget | null>(null);

  const label = (dim: BreakdownDimension) =>
    dim === "goal" ? t("analytics.overview.goals") : t(`analytics.filters.dims.${dim}`);

  const dims = (values: readonly BreakdownDimension[]): DimensionOption[] =>
    values.map((value) => ({ value, label: label(value) }));

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <SwitchedCard
          title={t("analytics.overview.pages")}
          options={dims(["path", "entryPath", "exitPath"])}
          scope={scope}
          win={win}
          onAddFilter={onAddFilter}
          onSeeAll={setSeeAll}
        />
        <SwitchedCard
          title={t("analytics.overview.sources")}
          options={dims(["channel", "referrer", "utmCampaign", "utmSource", "utmMedium"])}
          scope={scope}
          win={win}
          onAddFilter={onAddFilter}
          onSeeAll={setSeeAll}
        />
        <LocationsCard scope={scope} win={win} onAddFilter={onAddFilter} onSeeAll={setSeeAll} />
        <SwitchedCard
          title={t("analytics.overview.devices")}
          options={dims(["browser", "os", "device", "screen"])}
          scope={scope}
          win={win}
          onAddFilter={onAddFilter}
          onSeeAll={setSeeAll}
        />
        <GoalsCard scope={scope} win={win} onAddFilter={onAddFilter} onShowEvents={onShowEvents} />
        <RealtimeMiniCard scope={scope} onShowRealtime={onShowRealtime} />
      </div>
      <OverviewSeeAll
        target={seeAll}
        scope={scope}
        win={win}
        onClose={() => setSeeAll(null)}
        onAddFilter={onAddFilter}
      />
    </>
  );
}

function SwitchedCard({
  title,
  options,
  scope,
  win,
  onAddFilter,
  onSeeAll,
}: {
  title: string;
  options: DimensionOption[];
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  onAddFilter: (dim: FilterDimension, key: string) => void;
  onSeeAll: (target: SeeAllTarget) => void;
}) {
  const [dimension, setDimension] = useState<BreakdownDimension>(options[0].value);
  const query = useBreakdown(scope, win, dimension, { limit: CARD_LIMIT });
  return (
    <BreakdownCard
      title={title}
      dimensions={options}
      dimension={dimension}
      onDimensionChange={setDimension}
      onSeeAll={() => onSeeAll({ title, dimension })}
      loading={query.isPending}
      rows={query.data?.rows ?? []}
      mono={isMonoDimension(dimension)}
      renderLeading={leadingFor(dimension)}
      onRowClick={
        dimension === "goal"
          ? undefined
          : (key) => {
              const dim = options.find((o) => o.value === dimension)?.value;
              if (dim && dim !== "goal") onAddFilter(dim, key);
            }
      }
    />
  );
}

function LocationsCard({
  scope,
  win,
  onAddFilter,
  onSeeAll,
}: {
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  onAddFilter: (dim: FilterDimension, key: string) => void;
  onSeeAll: (target: SeeAllTarget) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<LocationsMode>("list");
  const list = useBreakdown(scope, win, "country", { limit: CARD_LIMIT });
  // The map needs the full spread of countries, not the top six; only paid
  // for while the map is showing.
  const mapData = useBreakdown(scope, win, "country", {
    limit: 300,
    enabled: mode === "map",
  });
  return (
    <BreakdownCard
      title={t("analytics.overview.locations")}
      onSeeAll={() => onSeeAll({ title: t("analytics.overview.locations"), dimension: "country" })}
      headerExtra={<ListMapToggle mode={mode} onChange={setMode} />}
      loading={list.isPending}
      rows={list.data?.rows ?? []}
      renderLeading={leadingFor("country")}
      displayKey={countryName}
      mono={false}
      onRowClick={(key) => onAddFilter("country", key)}
      body={
        mode === "map" ? (
          <LocationsMap rows={mapData.data?.rows ?? []} total={mapData.data?.total ?? 0} />
        ) : undefined
      }
    />
  );
}

function GoalsCard({
  scope,
  win,
  onAddFilter,
  onShowEvents,
}: {
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  onAddFilter: (dim: FilterDimension, key: string) => void;
  onShowEvents: () => void;
}) {
  const { t } = useTranslation();
  const query = useBreakdown(scope, win, "goal", { limit: CARD_LIMIT });
  const rows = query.data?.rows ?? [];
  return (
    <BreakdownCard
      title={t("analytics.overview.goals")}
      loading={query.isPending}
      rows={rows}
      mono={false}
      formatValue={(row) =>
        `${formatCount(row.conversions ?? row.visitors)}${
          row.conversionRate !== undefined ? ` · ${(row.conversionRate * 100).toFixed(1)}%` : ""
        }`
      }
      onRowClick={(key) => onAddFilter("event", key)}
      body={
        !query.isPending && rows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="max-w-56 text-xs text-muted-foreground">
              {t("analytics.overview.goalsEmpty")}
            </p>
            <button
              type="button"
              onClick={onShowEvents}
              className="text-xs font-medium underline-offset-2 hover:underline"
            >
              {t("analytics.overview.goalsEmptyAction")}
            </button>
          </div>
        ) : undefined
      }
    />
  );
}
