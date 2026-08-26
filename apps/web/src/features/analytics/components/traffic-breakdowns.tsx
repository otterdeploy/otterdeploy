/**
 * The Traffic tab's breakdown grid: eight cards on the Overview's shared
 * shell, fed by the edge plane's day-granular rollups. Domains is the one
 * card with a filter behind it (toggle-style: clicking the applied host
 * clears it); every card opens the shared See-all dialog over the full
 * top-N the API already sent, so there is nothing more to page.
 */

import type { ReactNode } from "react";
import { useState } from "react";

import { useTranslation } from "react-i18next";

import type { TopEntry } from "../analytics-model";

import { countryName } from "../analytics-model";
import { CountryFlag } from "./country-flag";
import { BreakdownCard, type BreakdownRowData } from "./overview/breakdown-card";
import { ReferrerGlyph } from "./overview/dimension-leading";
import { ListMapToggle, type LocationsMode } from "./overview/list-map-toggle";
import { LocationsMap } from "./overview/locations-map";
import { SeeAllDialog } from "./overview/see-all-dialog";
import { StatusMix } from "./status-mix";
import { UaIcon } from "./ua-icon";

export interface BreakdownDims {
  hosts: TopEntry[];
  statuses: TopEntry[];
  paths: TopEntry[];
  referrers: TopEntry[];
  countries: TopEntry[];
  browsers: TopEntry[];
  oses: TopEntry[];
  deviceTypes: TopEntry[];
}

type DimKey = keyof BreakdownDims;

const TITLE_KEYS = {
  hosts: "analytics.traffic.domains",
  statuses: "analytics.traffic.responses",
  paths: "analytics.traffic.topPaths",
  referrers: "analytics.traffic.referrers",
  countries: "analytics.traffic.countries",
  browsers: "analytics.traffic.browsers",
  oses: "analytics.traffic.operatingSystems",
  deviceTypes: "analytics.traffic.devices",
} as const satisfies Record<DimKey, string>;

const DIM_KEYS = {
  hosts: "analytics.traffic.dim.hosts",
  statuses: "analytics.traffic.dim.statuses",
  paths: "analytics.traffic.dim.paths",
  referrers: "analytics.traffic.dim.referrers",
  countries: "analytics.traffic.dim.countries",
  browsers: "analytics.traffic.dim.browsers",
  oses: "analytics.traffic.dim.oses",
  deviceTypes: "analytics.traffic.dim.deviceTypes",
} as const satisfies Record<DimKey, string>;

/** Dimensions whose keys are names, not machine strings. */
const SANS_DIMS: ReadonlySet<DimKey> = new Set(["countries", "browsers", "oses", "deviceTypes"]);

const LEADING: Partial<Record<DimKey, (key: string) => ReactNode>> = {
  referrers: () => <ReferrerGlyph />,
  countries: (key) => <CountryFlag code={key} />,
  browsers: (key) => <UaIcon kind="browser" value={key} />,
  oses: (key) => <UaIcon kind="os" value={key} />,
  deviceTypes: (key) => <UaIcon kind="device" value={key} />,
};

function sumCounts(entries: readonly TopEntry[]): number {
  return entries.reduce((s, e) => s + e.count, 0);
}

/** Ranked entries → card rows; share is of the dimension's own total. */
function toRows(entries: readonly TopEntry[]): BreakdownRowData[] {
  const total = sumCounts(entries);
  return entries.map((e) => ({
    key: e.key,
    visitors: e.count,
    share: total > 0 ? e.count / total : 0,
  }));
}

export function TrafficBreakdowns({
  dims,
  hostFilter,
  onHostFilterChange,
}: {
  /** Undefined while the breakdowns query is still in flight. */
  dims: BreakdownDims | undefined;
  hostFilter: string | undefined;
  /** Toggle-style: clicking the active host clears the filter. */
  onHostFilterChange: (host: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [seeAll, setSeeAll] = useState<DimKey | null>(null);
  const [mode, setMode] = useState<LocationsMode>("list");
  const loading = dims === undefined;
  const rowsOf = (key: DimKey) => (dims ? toRows(dims[key]) : []);
  const countryLabel = (key: string) =>
    key === "other" ? t("analytics.traffic.other") : countryName(key);
  const toggleHost = (host: string) => onHostFilterChange(host === hostFilter ? undefined : host);

  const seeAllRows = seeAll ? rowsOf(seeAll) : [];

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <BreakdownCard
          title={t(TITLE_KEYS.hosts)}
          onSeeAll={() => setSeeAll("hosts")}
          headerExtra={
            dims ? (
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {dims.hosts.length}
              </span>
            ) : undefined
          }
          loading={loading}
          rows={rowsOf("hosts")}
          selectedKey={hostFilter}
          onRowClick={toggleHost}
        />
        <BreakdownCard
          title={t(TITLE_KEYS.statuses)}
          onSeeAll={() => setSeeAll("statuses")}
          loading={loading}
          rows={rowsOf("statuses")}
          body={dims ? <StatusMix entries={dims.statuses} /> : undefined}
        />
        <BreakdownCard
          title={t(TITLE_KEYS.paths)}
          onSeeAll={() => setSeeAll("paths")}
          loading={loading}
          rows={rowsOf("paths")}
        />
        <BreakdownCard
          title={t(TITLE_KEYS.referrers)}
          onSeeAll={() => setSeeAll("referrers")}
          loading={loading}
          rows={rowsOf("referrers")}
          renderLeading={LEADING.referrers}
        />
        <BreakdownCard
          title={t(TITLE_KEYS.countries)}
          onSeeAll={() => setSeeAll("countries")}
          headerExtra={<ListMapToggle mode={mode} onChange={setMode} />}
          loading={loading}
          rows={rowsOf("countries")}
          renderLeading={LEADING.countries}
          displayKey={countryLabel}
          mono={false}
          body={
            mode === "map" && dims ? (
              <LocationsMap rows={rowsOf("countries")} total={sumCounts(dims.countries)} />
            ) : undefined
          }
        />
        <BreakdownCard
          title={t(TITLE_KEYS.browsers)}
          onSeeAll={() => setSeeAll("browsers")}
          loading={loading}
          rows={rowsOf("browsers")}
          renderLeading={LEADING.browsers}
          mono={false}
        />
        <BreakdownCard
          title={t(TITLE_KEYS.oses)}
          onSeeAll={() => setSeeAll("oses")}
          loading={loading}
          rows={rowsOf("oses")}
          renderLeading={LEADING.oses}
          mono={false}
        />
        <BreakdownCard
          title={t(TITLE_KEYS.deviceTypes)}
          onSeeAll={() => setSeeAll("deviceTypes")}
          loading={loading}
          rows={rowsOf("deviceTypes")}
          renderLeading={LEADING.deviceTypes}
          mono={false}
        />
      </div>

      <SeeAllDialog
        open={seeAll !== null}
        onClose={() => setSeeAll(null)}
        title={seeAll ? t(TITLE_KEYS[seeAll]) : ""}
        dimensionLabel={seeAll ? t(DIM_KEYS[seeAll]) : ""}
        total={seeAllRows.reduce((s, r) => s + r.visitors, 0)}
        unitLabel={t("analytics.traffic.inRange")}
        rows={seeAllRows}
        loading={loading}
        valueLabel={t("analytics.traffic.requests")}
        valueOf={(row) => row.visitors}
        displayKey={seeAll === "countries" ? countryLabel : undefined}
        renderLeading={seeAll ? LEADING[seeAll] : undefined}
        mono={seeAll === null || !SANS_DIMS.has(seeAll)}
        selectedKey={seeAll === "hosts" ? hostFilter : undefined}
        onPick={seeAll === "hosts" ? toggleHost : undefined}
      />
    </>
  );
}
