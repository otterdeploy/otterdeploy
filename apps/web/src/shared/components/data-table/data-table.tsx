/**
 * The data table.
 *
 * One component per list surface in the product, assembled from a column
 * declaration and a feed endpoint. What it owns, so that fifteen tables no
 * longer each decide it:
 *
 * - filters in the URL, with counts, so a filtered view is a link;
 * - server-side filtering, sorting, faceting and cursor pagination;
 * - virtualized rows with honest loading, empty and error states;
 * - a row-detail sheet that is itself linkable and walkable with ↑/↓;
 * - column visibility and density, remembered per table;
 * - a histogram over exactly the rows being shown.
 *
 * The surface supplies what only it knows: what a row IS, what its columns
 * mean, and where the rows come from.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";
import type { RowData } from "@tanstack/react-table";

import { useCallback, useMemo, useState } from "react";

import type { FeedPage } from "@/shared/components/data-table/feed/types";
import type { FeedInput } from "@/shared/components/data-table/feed/types";
import type { Density } from "@/shared/components/data-table/parts/table-view";
import type { DataTableColumn } from "@/shared/components/data-table/schema/types";
import type { TableSort } from "@/shared/components/data-table/state/search-schema";

import { canLoadMore, useFeed } from "@/shared/components/data-table/feed/use-feed";
import { DataTableFilterPanel } from "@/shared/components/data-table/parts/filter-panel";
import { DataTableHistogram } from "@/shared/components/data-table/parts/histogram";
import { DataTableRowSheet } from "@/shared/components/data-table/parts/row-sheet";
import { TableBodyRegion } from "@/shared/components/data-table/parts/table-body-region";
import { DataTableToolbar } from "@/shared/components/data-table/parts/toolbar";
import { DataTableViewOptions } from "@/shared/components/data-table/parts/view-options";
import { buildColumns } from "@/shared/components/data-table/schema/columns";
import { useActiveFilterCount, useFilterActions } from "@/shared/components/data-table/state/store";
import { useDataTable } from "@/shared/components/data-table/use-data-table";
import { cn } from "@/shared/lib/utils";

export interface DataTableProps<TRow extends RowData> {
  /** The column declaration. Stable — define it at module level. */
  columns: readonly DataTableColumn<TRow>[];
  /** Cache identity for this table's data. */
  queryKey: readonly unknown[];
  fetchPage: (input: FeedInput) => Promise<FeedPage<TRow>>;
  getRowId: (row: TRow) => string;
  /** Row identity for the detail sheet's title. */
  rowTitle: (row: TRow) => React.ReactNode;

  /** Filter values, sort and open row — all held in the URL by the route. */
  filters: Record<string, unknown>;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  openRowId: string | null;
  onOpenRow: (rowId: string | null) => void;

  pageSize?: number;
  searchPlaceholder?: string;
  /** Category tones for the histogram, when its categories mean something. */
  histogramTones?: Record<string, string>;
  histogramOrder?: readonly string[];
  /** Which filter key the histogram's zoom writes to. */
  timeKey?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Surface-specific toolbar controls (live, export, bulk actions).
   *
   * A render prop, because the useful ones need the rows: an export button
   * without them is a button that cannot say what it would export.
   */
  actions?: React.ReactNode | ((context: { rows: TRow[]; isFetching: boolean }) => React.ReactNode);
  /** Extra content in the row-detail sheet, under the fields. */
  sheetExtra?: (row: TRow) => React.ReactNode;
  /** Dims rows behind a live tail, or marks failures. */
  rowClassName?: (row: TRow) => string | undefined;
  className?: string;
}

/**
 * The table-wide search, as a filter spec.
 *
 * It lives in the toolbar rather than the sidebar because a search box is
 * looked for at the top of a table, and because it names several columns — a
 * sidebar section titled after one of them would be a lie about the other two.
 */
function searchSpecOf<TRow extends RowData>(
  columns: readonly DataTableColumn<TRow>[],
): FilterSpec | undefined {
  const column = columns.find((candidate) => candidate.filter?.type === "search");
  if (!column?.filter) return undefined;
  return { key: column.key, type: "search", kind: column.kind, keys: column.filter.keys };
}

export function DataTable<TRow extends RowData>({
  columns: declaration,
  queryKey,
  fetchPage,
  getRowId,
  rowTitle,
  filters,
  sort,
  onSortChange,
  openRowId,
  onOpenRow,
  pageSize = 50,
  searchPlaceholder,
  histogramTones,
  histogramOrder,
  timeKey,
  emptyTitle,
  emptyDescription,
  actions,
  sheetExtra,
  rowClassName,
  className,
}: DataTableProps<TRow>) {
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [density, setDensity] = useState<Density>("comfortable");
  const { setValue, resetAll } = useFilterActions();
  const activeFilters = useActiveFilterCount();

  const feed = useFeed<TRow>({ queryKey, fetchPage, filters, sort, size: pageSize });

  const columns = useMemo(() => buildColumns(declaration), [declaration]);
  const { table, prefs } = useDataTable({
    columns,
    schema: declaration,
    data: feed.rows,
    getRowId,
    sort,
    onSortChange,
  });

  const rows = table.getRowModel().rows;
  const searchSpec = useMemo(() => searchSpecOf(declaration), [declaration]);

  // Neighbours for the sheet's ↑/↓, taken from the rows as DISPLAYED — walking
  // the feed should follow the order on screen, not the order it arrived in.
  const openIndex = rows.findIndex((row) => row.id === openRowId);
  const openRow = openIndex >= 0 ? rows[openIndex]?.original : undefined;

  const loadMore = useCallback(() => {
    if (feed.isFetchingNextPage) return;
    if (
      !canLoadMore({
        hasNextPage: feed.hasNextPage,
        loaded: feed.rows.length,
        filterRowCount: feed.filterRowCount,
      })
    ) {
      return;
    }
    void feed.fetchNextPage();
  }, [feed]);

  const hasMore = canLoadMore({
    hasNextPage: feed.hasNextPage,
    loaded: feed.rows.length,
    filterRowCount: feed.filterRowCount,
  });

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <DataTableToolbar
        searchSpec={searchSpec}
        searchPlaceholder={searchPlaceholder}
        loaded={feed.rows.length}
        filterRowCount={feed.filterRowCount}
        totalRowCount={feed.totalRowCount}
        isFetching={feed.isFetching}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
        actions={
          <>
            {typeof actions === "function"
              ? actions({ rows: feed.rows, isFetching: feed.isFetching })
              : actions}
            <DataTableViewOptions
              table={table}
              density={density}
              onDensityChange={setDensity}
              onResetColumns={prefs.reset}
              isCustomized={prefs.isCustomized}
            />
          </>
        }
      />

      {timeKey ? (
        <DataTableHistogram
          data={feed.histogram}
          tones={histogramTones}
          order={histogramOrder}
          isLoading={feed.isLoading}
          onZoom={(range) => setValue(timeKey, range)}
          className="border-b px-2 pt-2"
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        {filtersOpen ? (
          <aside
            aria-label="Filters"
            className="hidden w-56 shrink-0 overflow-y-auto border-r sm:block lg:w-64"
          >
            <DataTableFilterPanel columns={declaration} facets={feed.facets} />
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <TableBodyRegion
            feed={feed}
            table={table}
            rows={rows}
            density={density}
            hasFilters={activeFilters > 0}
            onClearFilters={resetAll}
            onOpenRow={onOpenRow}
            onLoadMore={loadMore}
            hasMore={hasMore}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
            rowClassName={rowClassName}
          />
        </div>
      </div>

      <DataTableRowSheet
        row={openRow}
        columns={declaration}
        openRowId={openRowId}
        onOpenRow={onOpenRow}
        previousRowId={openIndex > 0 ? (rows[openIndex - 1]?.id ?? null) : null}
        nextRowId={openIndex >= 0 ? (rows[openIndex + 1]?.id ?? null) : null}
        title={rowTitle}
      >
        {openRow && sheetExtra ? sheetExtra(openRow) : null}
      </DataTableRowSheet>
    </div>
  );
}
