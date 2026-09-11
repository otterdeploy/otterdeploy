/**
 * The plumbing every table surface repeats, in one place.
 *
 * A surface's own file should hold what is true of THAT surface — its columns,
 * where its rows come from, what its actions do. Everything between the route's
 * search params and `<DataTable>`'s props is the same in all of them: coerce the
 * bag into filter values, build the store, read the sort, and write the sort and
 * the open row back as a patch. Three copies of it was three chances to forget
 * `replace: true` and fill someone's back button with filter clicks.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";

import { useCallback, useMemo } from "react";

import {
  filterValuesOf,
  parseSort,
  serializeSort,
  type TableSort,
} from "@/shared/components/data-table/state/search-schema";
import { useSearchFilterStore } from "@/shared/components/data-table/state/use-search-store";

export interface TableSurfaceOptions {
  /** Remembers columns, widths and density. Scope it if one table renders twice. */
  tableId: string;
  /** The declaration the server compiles too — the one definition of meaning. */
  specs: readonly FilterSpec[];
  /** The route's search bag, whatever else it also holds. */
  search: Record<string, unknown>;
  /** Merge a patch into the route's search params. Must replace history. */
  onSearchChange: (patch: Record<string, unknown>) => void;
}

/**
 * Filter values, the store, and the three handlers `<DataTable>` asks for.
 *
 * `search` is read rather than destructured because a route's bag holds more
 * than this table's keys — a tab, a pane, a log source — and `filterValuesOf`
 * is the validator that decides which of them are filters at all.
 */
export function useTableSurface({ tableId, specs, search, onSearchChange }: TableSurfaceOptions) {
  const filters = useMemo(() => filterValuesOf(search, specs), [search, specs]);

  const store = useSearchFilterStore({ tableId, specs, values: filters, onChange: onSearchChange });

  const sort = parseSort(typeof search.sort === "string" ? search.sort : undefined);
  const onSortChange = useCallback(
    (next: TableSort | null) => onSearchChange({ sort: serializeSort(next) }),
    [onSearchChange],
  );

  const onOpenRow = useCallback(
    (rowId: string | null) => onSearchChange({ row: rowId ?? undefined }),
    [onSearchChange],
  );

  return {
    filters,
    store,
    sort,
    onSortChange,
    /** The row whose sheet is open, so a row is linkable too. */
    openRowId: typeof search.row === "string" ? search.row : null,
    onOpenRow,
  };
}
