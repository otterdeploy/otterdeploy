/**
 * Per-table column-visibility preference — which columns the user hid via the
 * toolbar's Columns popover. Browser-local (localStorage), keyed by database
 * resource + schema-qualified table. Hidden columns are excluded from the GRID
 * only; exports always carry every column.
 */

import type { TableRef } from "./queries";

const key = (resourceId: string, table: TableRef) =>
  `otter:data-hidden-columns:${resourceId}:${table.schema}.${table.name}`;

export function loadHiddenColumns(resourceId: string, table: TableRef | null): string[] {
  if (!table) return [];
  try {
    const raw = localStorage.getItem(key(resourceId, table));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

export function saveHiddenColumns(resourceId: string, table: TableRef, hidden: string[]) {
  try {
    if (hidden.length === 0) localStorage.removeItem(key(resourceId, table));
    else localStorage.setItem(key(resourceId, table), JSON.stringify(hidden));
  } catch {
    /* storage unavailable — visibility just won't persist */
  }
}
