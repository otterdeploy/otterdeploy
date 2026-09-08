/**
 * Which columns a person keeps, and in what order — remembered per table.
 *
 * Browser-local and per `tableId`: a preference about how one operator reads
 * one table is not org state, and syncing it would make two people fight over
 * the same list. Hidden columns are hidden from the GRID only; the row-detail
 * sheet and any export still carry every column, because "I collapsed a column"
 * is not "I do not want this data".
 */

import type { ColumnOrderState, ColumnVisibilityState } from "@tanstack/react-table";

import { useCallback, useSyncExternalStore } from "react";

import { Result } from "better-result";
import * as z from "zod";

const prefsSchema = z.object({
  order: z.array(z.string()).default([]),
  hidden: z.array(z.string()).default([]),
});

type ColumnPrefs = z.infer<typeof prefsSchema>;

const EMPTY: ColumnPrefs = { order: [], hidden: [] };

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
  const isDefault = prefs.order.length === 0 && prefs.hidden.length === 0;
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
  setColumnOrder: (next: ColumnOrderState) => void;
  setColumnVisibility: (next: ColumnVisibilityState) => void;
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
      publish(tableId, { order: snapshot(tableId).order, hidden });
    },
    [tableId],
  );

  const setColumnOrder = useCallback(
    (next: ColumnOrderState) =>
      publish(tableId, { order: [...next], hidden: snapshot(tableId).hidden }),
    [tableId],
  );

  const reset = useCallback(() => publish(tableId, EMPTY), [tableId]);

  const columnVisibility: ColumnVisibilityState = { ...defaultVisibility };
  for (const key of prefs.hidden) columnVisibility[key] = false;

  return {
    columnOrder: prefs.order,
    columnVisibility,
    setColumnOrder,
    setColumnVisibility,
    reset,
    isCustomized: prefs.order.length > 0 || prefs.hidden.length > 0,
  };
}
