/**
 * The TanStack Table v9 feature set the editable data grid is built against.
 *
 * Separate from `data-table/features.ts` on purpose: the grid is a spreadsheet
 * (cell focus, in-place editing, paste, column pinning) and the data table is a
 * read-oriented feed (server cursor, facets, a filter sidebar). They share no
 * component, and `TFeatures` is invariant in v9 — one set that satisfied both
 * would force every table in the app to carry the other's machinery.
 */

import {
  columnFilteringFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_equals,
  filterFn_includesString,
  filterFn_inNumberRange,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";

import type { DataGridColumnMeta, DataGridTableMeta } from "./types";

/**
 * Phantom values for the typed meta slots — only their types are read, and both
 * are stripped at runtime. Every field is optional, so an annotated empty
 * object produces one without a type assertion.
 */
const tableMeta: DataGridTableMeta = {};
const columnMeta: DataGridColumnMeta = {};

export const dataGridFeatures = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),

  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),

  rowSelectionFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  // The row-number / select gutter is pinned left while the grid scrolls.
  columnPinningFeature,
  columnSizingFeature,
  columnResizingFeature,

  // The `'auto'` resolution set. In v9 an unregistered filter name does not
  // fall back — the column silently stops filtering.
  filterFns: {
    includesString: filterFn_includesString,
    inNumberRange: filterFn_inNumberRange,
    equals: filterFn_equals,
  },
  sortFns: {
    datetime: sortFn_datetime,
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
  },

  tableMeta,
  columnMeta,
});

export type DataGridFeatures = typeof dataGridFeatures;
