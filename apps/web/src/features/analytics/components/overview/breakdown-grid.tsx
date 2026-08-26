/**
 * The overview's breakdown grid: six cards on one shared shell. Every card
 * owns its dimension switcher locally (which page/source facet you're reading
 * is a lens, not shareable state) while row clicks write real filters into
 * the URL through the parent.
 */

import type { BreakdownDimension, FilterDimension } from "@otterdeploy/shared/analytics-filters";

import { useState } from "react";

import { useTranslation } from "react-i18next";

import { CountryFlag } from "@/features/analytics/components/country-flag";

import { countryName, formatCount } from "../../analytics-model";
import {
  type AnalyticsScope,
  type AnalyticsWindowState,
  useBreakdown,
} from "../../hooks/use-web-analytics";
import { BreakdownCard, type DimensionOption } from "./breakdown-card";
import { LocationsMap } from "./locations-map";
import { RealtimeMiniCard } from "./realtime-mini-card";
import { SeeAllDialog } from "./see-all-dialog";

const CARD_LIMIT = 6;

/** Dimensions rendered in sans: their keys are names, not machine strings. */
const SANS_DIMENSIONS: ReadonlySet<BreakdownDimension> = new Set([
  "channel",
  "country",
  "browser",
  "os",
  "device",
  "language",
]);

interface SeeAllTarget {
  title: string;
  dimension: BreakdownDimension;
}

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
      <SeeAllDialog
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
      mono={!SANS_DIMENSIONS.has(dimension)}
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
  const [mode, setMode] = useState<"list" | "map">("list");
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
      headerExtra={
        <div className="flex items-center rounded-md bg-muted p-0.5 text-xs" role="tablist">
          {(["list", "map"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={
                mode === value
                  ? "rounded-[5px] bg-background px-2 py-0.5 font-medium shadow-none ring-1 ring-foreground/10"
                  : "rounded-[5px] px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {t(value === "list" ? "analytics.overview.listMode" : "analytics.overview.mapMode")}
            </button>
          ))}
        </div>
      }
      loading={list.isPending}
      rows={list.data?.rows ?? []}
      renderLeading={(key) => <CountryFlag code={key} />}
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
