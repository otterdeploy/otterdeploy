/**
 * How one person reads one table — remembered per table.
 *
 * Which columns they keep, in what order, how wide they dragged them, and how
 * tight the rows are. All four are the same kind of fact and live under one
 * key, so a table restores in one read rather than four.
 *
 * Browser-local and per `tableId`: a preference about how one operator reads
 * one table is not org state, and syncing it would make two people fight over
 * the same list. Hidden columns are hidden from the GRID only; the row-detail
 * sheet and any export still carry every column, because "I collapsed a column"
 * is not "I do not want this data".
 */

import type {
  ColumnOrderState,
  ColumnSizingState,
  ColumnVisibilityState,
} from "@tanstack/react-table";

import { useCallback, useSyncExternalStore } from "react";

import { Result } from "better-result";
import * as z from "zod";

import type { Density } from "@/shared/components/data-table/parts/density";

import { DEFAULT_DENSITY } from "@/shared/components/data-table/parts/density";

const prefsSchema = z.object({
  order: z.array(z.string()).default([]),
  hidden: z.array(z.string()).default([]),
  /** Only the columns the reader actually dragged; the rest keep their declared width. */
  sizes: z.record(z.string(), z.number().positive()).default({}),
  density: z.enum(["compact", "comfortable"]).optional(),
});

type ColumnPrefs = z.infer<typeof prefsSchema>;

const EMPTY: ColumnPrefs = { order: [], hidden: [], sizes: {} };

function isDefaultPrefs(prefs: ColumnPrefs): boolean {
  return (
    prefs.order.length === 0 &&
    prefs.hidden.length === 0 &&
    Object.keys(prefs.sizes).length === 0 &&
    prefs.density === undefined
  );
}

const storageKey = (tableId: string) => `otter:table-columns:${tableId}`;

function readStorage(tableId: string): ColumnPrefs {
  const raw = Result.try({
    // Reading can throw outright when site data is blocked, not just return null.
    try: () => window.localStorage.getItem(storageKey(tableId)),
    catch: () => null,
  }).unwrapOr(null);
  if (!raw) return EMPTY;
  const parsed = Result.try({ try: (): unknown => JSON.parse(raw), catch: () => null });
  if (parsed.isErr()) return EMPTY;
  const checked = prefsSchema.safeParse(parsed.value);
  return checked.success ? checked.data : EMPTY;
}

function writeStorage(tableId: string, prefs: ColumnPrefs): void {
  const isDefault = isDefaultPrefs(prefs);
  Result.try({
    try: () =>
      isDefault
        ? window.localStorage.removeItem(storageKey(tableId))
        : window.localStorage.setItem(storageKey(tableId), JSON.stringify(prefs)),
    // Storage can be unavailable (private mode, a full quota). A preference that
    // fails to persist is not worth an error; it simply does not persist.
    catch: () => null,
  });
}

/**
 * One cached value per table, so `getSnapshot` can be called on every render
 * without touching localStorage and without handing back a fresh object (which
 * would make `useSyncExternalStore` re-render forever).
 */
const cache = new Map<string, ColumnPrefs>();
const listeners = new Map<string, Set<() => void>>();

function snapshot(tableId: string): ColumnPrefs {
  const cached = cache.get(tableId);
  if (cached) return cached;
  const loaded = readStorage(tableId);
  cache.set(tableId, loaded);
  return loaded;
}

function publish(tableId: string, prefs: ColumnPrefs): void {
  cache.set(tableId, prefs);
  writeStorage(tableId, prefs);
  for (const listener of listeners.get(tableId) ?? []) listener();
}

export interface ColumnPrefsState {
  columnOrder: ColumnOrderState;
  columnVisibility: ColumnVisibilityState;
  columnSizing: ColumnSizingState;
  density: Density;
  setColumnOrder: (next: ColumnOrderState) => void;
  setColumnVisibility: (next: ColumnVisibilityState) => void;
  setColumnSizing: (next: ColumnSizingState) => void;
  setDensity: (next: Density) => void;
  /** Back to the schema's own order and the columns it ships visible. */
  reset: () => void;
  /** True when the reader has changed something — the menu offers a reset. */
  isCustomized: boolean;
}

/**
 * Column order and visibility.
 *
 * Read through `useSyncExternalStore` rather than an effect: the server has no
 * localStorage, so the server snapshot is the schema's own defaults and the
 * stored value arrives on the client's first commit. That is hydration-safe by
 * construction, with no state written from an effect and no frame where a
 * hidden column flashes into view.
 */
export function useColumnPrefs(
  tableId: string,
  defaultVisibility: ColumnVisibilityState,
): ColumnPrefsState {
  const subscribe = useCallback(
    (listener: () => void) => {
      const forTable = listeners.get(tableId) ?? new Set<() => void>();
      forTable.add(listener);
      listeners.set(tableId, forTable);
      return () => {
        forTable.delete(listener);
      };
    },
    [tableId],
  );

  const getSnapshot = useCallback(() => snapshot(tableId), [tableId]);
  const getServerSnapshot = useCallback(() => EMPTY, []);
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setColumnVisibility = useCallback(
    (next: ColumnVisibilityState) => {
      const hidden = Object.entries(next)
        .filter(([, visible]) => visible === false)
        .map(([key]) => key);
      publish(tableId, { ...snapshot(tableId), hidden });
    },
    [tableId],
  );

  const setColumnOrder = useCallback(
    (next: ColumnOrderState) => publish(tableId, { ...snapshot(tableId), order: [...next] }),
    [tableId],
  );

  const setColumnSizing = useCallback(
    // Written on every drag frame, which is why it goes through the same cache
    // as the rest: the store is the one place that decides what persists.
    (next: ColumnSizingState) => publish(tableId, { ...snapshot(tableId), sizes: { ...next } }),
    [tableId],
  );

  const setDensity = useCallback(
    (next: Density) => publish(tableId, { ...snapshot(tableId), density: next }),
    [tableId],
  );

  const reset = useCallback(() => publish(tableId, EMPTY), [tableId]);

  const columnVisibility: ColumnVisibilityState = { ...defaultVisibility };
  for (const key of prefs.hidden) columnVisibility[key] = false;

  return {
    columnOrder: prefs.order,
    columnVisibility,
    columnSizing: prefs.sizes,
    density: prefs.density ?? DEFAULT_DENSITY,
    setColumnOrder,
    setColumnVisibility,
    setColumnSizing,
    setDensity,
    reset,
    isCustomized: !isDefaultPrefs(prefs),
  };
}
