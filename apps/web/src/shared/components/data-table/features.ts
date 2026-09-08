/**
 * The one TanStack Table v9 feature set every data table in the app is built
 * against.
 *
 * v9 stopped bundling features implicitly: each one is registered here together
 * with the row-model factory that powers it. Registering the set ONCE, in one
 * module, is not just tidiness — `TFeatures` is invariant in v9 (`in out`), so
 * a component generic over it can call no feature API at all. Every shared
 * component pins `DataTableFeatures`, and because that type is
 * `typeof dataTableFeatures`, adding a feature here updates all of them.
 *
 * Deliberately NOT `stockFeatures`: that pulls in all seventeen plus every
 * built-in filter and sort function, most of which no table here uses.
 */

import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFacetedMinMaxValues,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_arrIncludes,
  filterFn_arrIncludesSome,
  filterFn_equals,
  filterFn_inDateRange,
  filterFn_inNumberRange,
  filterFn_includesString,
  filterFn_weakEquals,
  globalFilteringFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";

/** Per-column metadata this app's tables attach. */
interface DataTableColumnMeta {
  /** Human label, used by the column menu and the row-detail sheet. */
  label?: string;
  /** What the column holds — drives cell alignment and the mono/sans cut. */
  kind?: "text" | "code" | "number" | "instant" | "badge" | "select" | "actions";
  headerClassName?: string;
  cellClassName?: string;
  /** Hidden by default, still toggleable in the column menu. */
  defaultHidden?: boolean;
}

/** Per-table metadata. */
interface DataTableMeta {
  /** Extra classes per row — how live mode dims rows behind the tail. */
  rowClassName?: (rowId: string) => string;
}

/**
 * Phantom values for the typed meta slots: only their TYPES are read, and the
 * values are stripped at runtime. Written as annotated empty objects rather
 * than `{} as Meta` — every field is optional, so no assertion is needed to
 * produce one.
 */
const tableMeta: DataTableMeta = {};
const columnMeta: DataTableColumnMeta = {};

export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),

  // The table-wide search box. Its semantics are the same `substringAny`
  // operation the server compiles, so running both is idempotent rather than
  // contradictory — which is the whole point of one filter vocabulary.
  globalFilteringFeature,

  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),

  columnFacetingFeature,
  facetedRowModel: createFacetedRowModel(),
  facetedMinMaxValues: createFacetedMinMaxValues(),
  facetedUniqueValues: createFacetedUniqueValues(),

  columnVisibilityFeature,
  columnOrderingFeature,
  rowSelectionFeature,

  // v8's single column-sizing feature is split in two: the sizes, and the drag.
  columnSizingFeature,
  columnResizingFeature,

  /**
   * `rowPaginationFeature` is deliberately absent.
   *
   * Every table here pages on the server through a cursor. Registering the
   * paginated row model would make `getRowModel()` route through it whenever
   * `manualPagination` is falsy — silently rendering the first ten rows of each
   * fetch. Leaving the feature out makes that failure unreachable instead of
   * relying on remembering a flag.
   */

  /**
   * `columnDef.filterFn` defaults to `'auto'`, which resolves by data type to
   * one of these names. In v9 an UNREGISTERED name does not fall back — the
   * column simply stops filtering (with a dev warning) — so the whole auto set
   * is registered even though generated columns carry their filter function
   * directly, as a function, and never look a name up.
   */
  filterFns: {
    includesString: filterFn_includesString,
    inNumberRange: filterFn_inNumberRange,
    equals: filterFn_equals,
    arrIncludes: filterFn_arrIncludes,
    arrIncludesSome: filterFn_arrIncludesSome,
    weakEquals: filterFn_weakEquals,
    inDateRange: filterFn_inDateRange,
  },

  /**
   * `columnDef.sortFn` also defaults to `'auto'`. Unlike filters an
   * unregistered sort name falls back to `sortFn_basic` — right for numbers,
   * wrong for dates and mixed alphanumeric strings — so these three are named.
   */
  sortFns: {
    datetime: sortFn_datetime,
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
  },

  // Typed meta slots instead of global declaration merging: two tables in one
  // app can disagree about their meta without one of them lying.
  tableMeta,
  columnMeta,
});

/**
 * The feature set as a type, for the `TFeatures` parameter v9 threads through
 * `Table`, `Row`, `Column`, `Cell` and `ColumnDef`.
 */
export type DataTableFeatures = typeof dataTableFeatures;
