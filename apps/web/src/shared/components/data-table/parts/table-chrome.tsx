/**
 * Everything above the rows: the toolbar, the query bar, and the histogram.
 *
 * Grouped into one component so the table itself reads as a layout — chrome,
 * filters, rows, sheet — rather than a hundred lines of conditional assembly.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";
import type { RowData } from "@tanstack/react-table";

import type { Facets } from "@/shared/components/data-table/feed/types";
import type { useFeed } from "@/shared/components/data-table/feed/use-feed";
import type { Density } from "@/shared/components/data-table/parts/density";
import type { ColumnPrefsState } from "@/shared/components/data-table/use-column-prefs";
import type { useDataTable } from "@/shared/components/data-table/use-data-table";

import {
  DataTableFilterCommand,
  FilterCommandTrigger,
} from "@/shared/components/data-table/parts/filter-command";
import { DataTableHistogram } from "@/shared/components/data-table/parts/histogram";
import { LiveToggle } from "@/shared/components/data-table/parts/live-toggle";
import { DataTableToolbar } from "@/shared/components/data-table/parts/toolbar";
import { DataTableViewOptions } from "@/shared/components/data-table/parts/view-options";

export interface TableChromeProps<TRow extends RowData> {
  searchSpec: FilterSpec | undefined;
  searchPlaceholder?: string;
  feed: ReturnType<typeof useFeed<TRow>>;
  table: ReturnType<typeof useDataTable<TRow>>["table"];
  prefs: ColumnPrefsState;
  density: Density;
  onDensityChange: (density: Density) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  queryOpen: boolean;
  onQueryOpenChange: (open: boolean) => void;
  specs: readonly FilterSpec[];
  actions?: React.ReactNode | ((context: { rows: TRow[]; isFetching: boolean }) => React.ReactNode);
  live: boolean;
  isLive: boolean;
  timeKey: string | undefined;
  histogramTones?: Record<string, string>;
  histogramOrder?: readonly string[];
  onZoom: (range: [number, number]) => void;
}

export function TableChrome<TRow extends RowData>({
  searchSpec,
  searchPlaceholder,
  feed,
  table,
  prefs,
  density,
  onDensityChange,
  filtersOpen,
  onToggleFilters,
  queryOpen,
  onQueryOpenChange,
  specs,
  actions,
  live,
  isLive,
  timeKey,
  histogramTones,
  histogramOrder,
  onZoom,
}: TableChromeProps<TRow>) {
  const facets: Facets = feed.facets;

  return (
    <>
      <DataTableToolbar
        searchSpec={searchSpec}
        searchPlaceholder={searchPlaceholder}
        loaded={feed.rows.length}
        filterRowCount={feed.filterRowCount}
        totalRowCount={feed.totalRowCount}
        isFetching={feed.isFetching}
        filtersOpen={filtersOpen}
        onToggleFilters={onToggleFilters}
        actions={
          <>
            <FilterCommandTrigger onOpen={() => onQueryOpenChange(true)} />
            {live ? <LiveToggle isLive={isLive} timeKey={timeKey} /> : null}
            {typeof actions === "function"
              ? actions({ rows: feed.rows, isFetching: feed.isFetching })
              : actions}
            <DataTableViewOptions
              table={table}
              density={density}
              onDensityChange={onDensityChange}
              onResetColumns={prefs.reset}
              isCustomized={prefs.isCustomized}
            />
          </>
        }
      />

      <DataTableFilterCommand
        specs={specs}
        facets={facets}
        open={queryOpen}
        onOpenChange={onQueryOpenChange}
      />

      {timeKey ? (
        <DataTableHistogram
          data={feed.histogram}
          tones={histogramTones}
          order={histogramOrder}
          isLoading={feed.isLoading}
          onZoom={onZoom}
          className="border-b px-2 pt-2"
        />
      ) : null}
    </>
  );
}
