/**
 * One surface, rendered on the REAL shell.
 *
 * Everything below the fixtures is production code: `<DataTable>`, the filter
 * store, the column declarations, the histogram, the row sheet. The only two
 * substitutions are the feed (fixtures instead of an endpoint) and the filter
 * state (local instead of the URL), and neither changes how anything looks or
 * behaves — the store's contract is `values` + `onChange`, and the route
 * happens to satisfy it with search params.
 *
 * So what you are looking at is not a picture of the table. It is the table.
 */

import type { RowData } from "@tanstack/react-table";

import { useCallback, useMemo, useState } from "react";

import type { DataTableColumn } from "@/shared/components/data-table/schema/types";
import type { TableSort } from "@/shared/components/data-table/state/search-schema";
import type { FilterValues } from "@/shared/components/data-table/state/store";

import { fixtureFeed } from "@/preview/fixture-feed";
import { DataTable } from "@/shared/components/data-table/data-table";
import { toFilterSpecs } from "@/shared/components/data-table/schema/types";
import { FilterStoreProvider } from "@/shared/components/data-table/state/store";
import { useSearchFilterStore } from "@/shared/components/data-table/state/use-search-store";

export interface SurfaceSpec<TRow extends RowData> {
  id: string;
  columns: readonly DataTableColumn<TRow>[];
  rows: readonly TRow[];
  getRowId: (row: TRow) => string;
  rowTitle: (row: TRow) => React.ReactNode;
  timeOf: (row: TRow) => number;
  timeKey: string;
  categoryOf?: (row: TRow) => string;
  histogramKey?: string;
  histogramTones?: Record<string, string>;
  histogramOrder?: readonly string[];
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  rowClassName?: (row: TRow) => string | undefined;
  live?: boolean;
  /**
   * Toolbar controls — export, refresh, bulk actions.
   *
   * The render-prop form gets the loaded rows, which is what an Export or a
   * "block all of these" needs to say what it would act on.
   */
  actions?: React.ReactNode | ((context: { rows: TRow[]; isFetching: boolean }) => React.ReactNode);
  /** Per-row controls, in a trailing column. */
  rowActions?: (row: TRow) => React.ReactNode;
}

export function SurfacePreview<TRow extends RowData>({ surface }: { surface: SurfaceSpec<TRow> }) {
  const [values, setValues] = useState<FilterValues>({});
  const [sort, setSort] = useState<TableSort | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const specs = useMemo(
    () => toFilterSpecs(surface.columns, timeZone),
    [surface.columns, timeZone],
  );

  const onChange = useCallback((patch: FilterValues) => {
    setValues((previous) => {
      const next: FilterValues = { ...previous };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      return next;
    });
  }, []);

  const store = useSearchFilterStore({
    tableId: `preview-${surface.id}`,
    specs,
    values,
    onChange,
  });

  const facetKeys = useMemo(
    () =>
      surface.columns
        .filter((column) => column.filter?.type === "checkbox")
        .map((column) => column.key),
    [surface.columns],
  );

  const fetchPage = useMemo(
    () =>
      fixtureFeed({
        rows: surface.rows,
        specs,
        timeOf: surface.timeOf,
        categoryOf: surface.categoryOf,
        facetKeys,
      }),
    [surface, specs, facetKeys],
  );

  return (
    <FilterStoreProvider store={store}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t">
        <DataTable<TRow>
          columns={surface.columns}
          queryKey={["preview", surface.id, JSON.stringify(values)]}
          fetchPage={fetchPage}
          getRowId={surface.getRowId}
          rowTitle={surface.rowTitle}
          filters={values}
          sort={sort}
          onSortChange={setSort}
          openRowId={openRowId}
          onOpenRow={setOpenRowId}
          timeKey={surface.timeKey}
          live={surface.live ?? true}
          histogramKey={surface.histogramKey}
          histogramTones={surface.histogramTones}
          histogramOrder={surface.histogramOrder}
          searchPlaceholder={surface.searchPlaceholder}
          emptyTitle={surface.emptyTitle}
          emptyDescription={surface.emptyDescription}
          rowClassName={surface.rowClassName}
          actions={surface.actions}
          rowActions={surface.rowActions}
        />
      </div>
    </FilterStoreProvider>
  );
}
