/**
 * The table instance: columns, state, and the wiring between the two.
 *
 * Filter state lives in the URL (the store), and TanStack's own `columnFilters`
 * is DERIVED from it rather than kept in parallel. There is exactly one source
 * of truth for "what is being filtered", so the sidebar, the command palette,
 * the address bar and the request can never disagree — which is the failure
 * every hand-rolled filter bar in this app eventually reached.
 */

import type {
  ColumnDef,
  ColumnOrderState,
  ColumnSizingState,
  ColumnVisibilityState,
  RowSelectionState,
  SortingState,
  Updater,
} from "@tanstack/react-table";

import { useMemo, useState } from "react";

import {
  functionalUpdate,
  useTable,
  type ColumnFiltersState,
  type RowData,
} from "@tanstack/react-table";

import type { DataTableColumn } from "@/shared/components/data-table/schema/types";
import type { TableSort } from "@/shared/components/data-table/state/search-schema";

import { dataTableFeatures } from "@/shared/components/data-table/features";
import { defaultColumnVisibility } from "@/shared/components/data-table/schema/types";
import { useFilterStore, useFilterValues } from "@/shared/components/data-table/state/store";
import { useColumnPrefs } from "@/shared/components/data-table/use-column-prefs";

export interface UseDataTableOptions<TRow extends RowData> {
  columns: ColumnDef<DataTableFeaturesAlias, TRow>[];
  /** The declaration, for visibility defaults and the filter controls. */
  schema: readonly DataTableColumn<TRow>[];
  data: TRow[];
  getRowId: (row: TRow) => string;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  /** Row selection and the bulk bar. Off unless a surface asks for it. */
  selectable?: boolean;
}

type DataTableFeaturesAlias = typeof dataTableFeatures;

export function useDataTable<TRow extends RowData>(options: UseDataTableOptions<TRow>) {
  const { columns, schema, data, getRowId, sort, onSortChange, selectable = false } = options;
  const store = useFilterStore();
  const values = useFilterValues();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const visibilityDefaults = useMemo(() => defaultColumnVisibility(schema), [schema]);
  const prefs = useColumnPrefs(store.tableId, visibilityDefaults);
  // Destructured so the memo below depends on the four values it reads rather
  // than on the prefs object, which is rebuilt every render by design.
  const {
    columnOrder,
    columnVisibility,
    columnSizing,
    setColumnOrder,
    setColumnVisibility,
    setColumnSizing,
  } = prefs;

  /**
   * The URL's sort, as TanStack holds it. A sort naming a column that no longer
   * exists is dropped rather than applied to nothing.
   */
  const sorting = useMemo<SortingState>(
    () =>
      sort && columns.some((column) => column.id === sort.key)
        ? [{ id: sort.key, desc: sort.desc }]
        : [],
    [sort, columns],
  );

  /**
   * Filter values → `columnFilters`.
   *
   * The client-side filter functions carry the same semantics the server
   * compiled, so applying both is idempotent: rows the server already narrowed
   * pass again unchanged. What it buys is a table that stays correct while a
   * request is in flight, and one that filters the loaded page instantly when
   * a surface has no server filtering at all.
   */
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const filters: ColumnFiltersState = [];
    for (const spec of store.specs) {
      // A `search` spans several columns, so it is a global filter, not a
      // column one — see `globalFilter` below.
      if (spec.type === "search") continue;
      const value = values[spec.key];
      if (value === null || value === undefined || value === "") continue;
      if (Array.isArray(value) && value.length === 0) continue;
      filters.push({ id: spec.key, value });
    }
    return filters;
  }, [values, store.specs]);

  const searchSpec = useMemo(
    () => store.specs.find((spec) => spec.type === "search"),
    [store.specs],
  );
  const globalFilter = searchSpec ? values[searchSpec.key] : undefined;

  /**
   * v9 memoizes the table on this object, so an inline literal hands back a new
   * table instance every render — and every consumer of it (toolbar, sidebar,
   * sheet, every row) re-renders on every keystroke, poll and resize tick.
   */
  const tableOptions = useMemo(
    () => ({
      features: dataTableFeatures,
      data,
      columns,
      getRowId,
      state: {
        sorting,
        columnFilters,
        rowSelection,
        columnOrder,
        columnVisibility,
        columnSizing,
        ...(globalFilter === undefined ? {} : { globalFilter }),
      },
      enableRowSelection: selectable,
      enableMultiRowSelection: selectable,
      columnResizeMode: "onChange" as const,
      // Sorting and filtering happen in the database; the client-side models
      // stay registered because they still run over the loaded page, and they
      // agree with the server by construction.
      manualSorting: true,
      onRowSelectionChange: setRowSelection,
      onColumnOrderChange: (updater: Updater<ColumnOrderState>) =>
        setColumnOrder(functionalUpdate(updater, columnOrder)),
      onColumnVisibilityChange: (updater: Updater<ColumnVisibilityState>) =>
        setColumnVisibility(functionalUpdate(updater, columnVisibility)),
      // Controlled, so a dragged width survives a reload. Uncontrolled sizing
      // is held inside the table instance, which a fetch or a route change
      // rebuilds — the reason the resize handles used to snap back.
      onColumnSizingChange: (updater: Updater<ColumnSizingState>) =>
        setColumnSizing(functionalUpdate(updater, columnSizing)),
      onSortingChange: (updater: Updater<SortingState>) => {
        // TanStack hands a value or a reducer; `functionalUpdate` is its own resolver.
        const first = functionalUpdate(updater, sorting)[0];
        onSortChange(first ? { key: first.id, desc: first.desc } : null);
      },
    }),
    [
      data,
      columns,
      getRowId,
      sorting,
      columnFilters,
      rowSelection,
      globalFilter,
      selectable,
      columnOrder,
      columnVisibility,
      columnSizing,
      setColumnOrder,
      setColumnVisibility,
      setColumnSizing,
      onSortChange,
    ],
  );

  const table = useTable(tableOptions);

  return { table, prefs, rowSelection, setRowSelection };
}
