/**
 * Filter state, subscribed to one field at a time.
 *
 * The table, the sidebar, the command palette, the histogram and every row all
 * read filter state. Handing them one context object re-renders the whole tree
 * whenever any of it changes — and the rows are the expensive part. So state
 * lives in a small external store and every consumer subscribes through a
 * SELECTOR: a row that watches `selected === row.id` re-renders when its own
 * selection flips and at no other time.
 *
 * Where the state actually LIVES is the provider's business (the URL, for every
 * real table; memory, for a dialog). This module only owns the subscription.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

/** Filter values keyed by column key, exactly as the URL and the API carry them. */
export type FilterValues = Record<string, unknown>;

export interface FilterStore {
  subscribe: (listener: () => void) => () => void;
  getValues: () => FilterValues;
  /** Merge a patch. `undefined` for a key clears it. */
  setValues: (patch: FilterValues) => void;
  /** Clear the named keys, or every filter when none are named. */
  reset: (keys?: readonly string[]) => void;
  /** Hold writes — live mode polls, and each poll must not push a URL update. */
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
  readonly specs: readonly FilterSpec[];
  readonly tableId: string;
}

const StoreContext = createContext<FilterStore | null>(null);

export function FilterStoreProvider({
  store,
  children,
}: {
  store: FilterStore;
  children: React.ReactNode;
}) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useFilterStore(): FilterStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useFilterStore must be used inside a <FilterStoreProvider>");
  }
  return store;
}

/**
 * Read filter state through a selector.
 *
 * The selector MUST return a stable value for unchanged state — a primitive, or
 * a value the store itself holds. Returning a fresh object each call makes
 * `useSyncExternalStore` re-render forever, which is why there is no
 * convenience overload that maps state into a new shape.
 */
export function useFilterValue<T>(select: (values: FilterValues) => T): T {
  const store = useFilterStore();
  const getSnapshot = useCallback(() => select(store.getValues()), [store, select]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** The whole value bag. For the query key and the request — not for a row. */
export function useFilterValues(): FilterValues {
  const store = useFilterStore();
  return useSyncExternalStore(store.subscribe, store.getValues, store.getValues);
}

export interface FilterActions {
  setValue: (key: string, value: unknown) => void;
  setValues: (patch: FilterValues) => void;
  resetValue: (key: string) => void;
  resetAll: () => void;
  pause: () => void;
  resume: () => void;
}

export function useFilterActions(): FilterActions {
  const store = useFilterStore();
  return useMemo(
    () => ({
      setValue: (key, value) => store.setValues({ [key]: value }),
      setValues: (patch) => store.setValues(patch),
      resetValue: (key) => store.reset([key]),
      resetAll: () => store.reset(),
      pause: () => store.pause(),
      resume: () => store.resume(),
    }),
    [store],
  );
}

/** One field, read and written. */
export function useFilterField(key: string) {
  const store = useFilterStore();
  const select = useCallback((values: FilterValues) => values[key], [key]);
  const value = useFilterValue(select);
  return useMemo(
    () => ({
      value,
      setValue: (next: unknown) => store.setValues({ [key]: next }),
      reset: () => store.reset([key]),
    }),
    [value, store, key],
  );
}

/**
 * How many filters are actually narrowing the view.
 *
 * Counted from the DECLARED specs rather than the value bag, so a stale key
 * left in a URL never shows up as an active filter the user cannot see or
 * clear.
 */
export function useActiveFilterCount(): number {
  const store = useFilterStore();
  const specs = store.specs;
  const select = useCallback(
    (values: FilterValues) =>
      specs.filter((spec) => {
        const value = values[spec.key];
        if (value === null || value === undefined || value === "") return false;
        return !(Array.isArray(value) && value.length === 0);
      }).length,
    [specs],
  );
  return useFilterValue(select);
}
