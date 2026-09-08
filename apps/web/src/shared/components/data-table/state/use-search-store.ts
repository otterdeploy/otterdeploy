/**
 * Filter state that lives in the URL.
 *
 * A filtered table is a LINK. That is the whole reason this is the default
 * store: an operator who found the three denied events at 04:12 can paste the
 * address into an incident channel and everyone else sees the same three rows.
 * State kept in a form or a `useState` cannot do that, and two of this app's
 * filter bars used to work exactly that way.
 *
 * TanStack Router validates and holds search params as real values — arrays and
 * numbers included — so nothing here encodes or parses. The route owns
 * `validateSearch`; this hook owns the subscription and the writes.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from "react";

import type { FilterStore, FilterValues } from "./store";

export interface SearchStoreOptions {
  /** Namespaces this table's stored column preferences. */
  tableId: string;
  /** The declared filters. Also the allow-list `reset()` clears. */
  specs: readonly FilterSpec[];
  /** Current search params, straight from the route. */
  values: FilterValues;
  /** Write a patch to the URL. `undefined` values must delete their key. */
  onChange: (patch: FilterValues) => void;
}

/** Same keys, same values? Used to skip a notify when the URL echoes a write back. */
function sameValues(a: FilterValues, b: FilterValues): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (left === right) continue;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length === right.length && left.every((item, index) => item === right[index])) {
        continue;
      }
    }
    return false;
  }
  return true;
}

function applyPatch(values: FilterValues, patch: FilterValues): FilterValues {
  const next: FilterValues = { ...values };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * A `FilterStore` backed by the route's search params.
 *
 * The store object is stable for the life of the table — every consumer
 * memoizes on it, and `useFilterActions`' identity reaches the callbacks handed
 * to memoized rows. A store that changed identity per render would re-render
 * every row in the table on every render of the table.
 *
 * Writes are applied to the store BEFORE they reach the router, so a checkbox
 * ticks under the pointer rather than a navigation later; the router echo then
 * arrives with the same content and notifies nobody.
 */
export function useSearchFilterStore(options: SearchStoreOptions): FilterStore {
  const { tableId, specs, values } = options;

  const listeners = useRef(new Set<() => void>());
  const valuesRef = useRef<FilterValues>(values);
  const pausedRef = useRef(false);
  const pendingRef = useRef<FilterValues | null>(null);

  const notify = useCallback(() => {
    for (const listener of listeners.current) listener();
  }, []);

  // Reads the latest `onChange` without making it a dependency — the callers
  // pass an inline arrow, so a dependency here would rebuild the store (and
  // re-render every row) on every render of the page.
  const push = useEffectEvent((patch: FilterValues) => {
    options.onChange(patch);
  });

  // The URL is the source of truth: an external navigation (back button, a
  // pasted link, another control on the page) lands here and wakes the
  // subscribers. An echo of our own write carries identical content and is
  // dropped, so it costs no render.
  useEffect(() => {
    if (sameValues(valuesRef.current, values)) return;
    valuesRef.current = values;
    notify();
  }, [values, notify]);

  return useMemo<FilterStore>(() => {
    const write = (patch: FilterValues) => {
      if (pausedRef.current) {
        pendingRef.current = { ...pendingRef.current, ...patch };
        return;
      }
      valuesRef.current = applyPatch(valuesRef.current, patch);
      notify();
      push(patch);
    };

    return {
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
      getValues: () => valuesRef.current,
      setValues: write,
      reset: (keys) => {
        // Only DECLARED keys are cleared: a reset must not silently drop the
        // page's other search params (a tab, a selected resource) that happen
        // to share the URL with the table.
        const target = keys ?? specs.map((spec) => spec.key);
        const patch: FilterValues = {};
        for (const key of target) patch[key] = undefined;
        write(patch);
      },
      pause: () => {
        pausedRef.current = true;
      },
      resume: () => {
        pausedRef.current = false;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) write(pending);
      },
      isPaused: () => pausedRef.current,
      specs,
      tableId,
    };
    // `push` is an effect event: stable by construction, and the two hook rules
    // disagree about it — the compiler cannot prove this memo without seeing it,
    // and exhaustive-deps forbids listing it. The memo is kept explicit rather
    // than left to the compiler because THIS object's identity is what every
    // memoized row in the table compares against.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specs, tableId, notify, push]);
}

/**
 * The same store, without a URL.
 *
 * For a table inside a dialog or a preview, where filters are not worth a
 * history entry and would collide with the page's own params.
 */
export function useMemoryFilterStore(options: {
  tableId: string;
  specs: readonly FilterSpec[];
  initial?: FilterValues;
}): FilterStore {
  const { tableId, specs } = options;
  const listeners = useRef(new Set<() => void>());
  const valuesRef = useRef<FilterValues>(options.initial ?? {});
  const pausedRef = useRef(false);

  const notify = useCallback(() => {
    for (const listener of listeners.current) listener();
  }, []);

  return useMemo<FilterStore>(() => {
    const write = (patch: FilterValues) => {
      valuesRef.current = applyPatch(valuesRef.current, patch);
      notify();
    };

    return {
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
      getValues: () => valuesRef.current,
      setValues: write,
      reset: (keys) => {
        const target = keys ?? specs.map((spec) => spec.key);
        const patch: FilterValues = {};
        for (const key of target) patch[key] = undefined;
        write(patch);
      },
      pause: () => {
        pausedRef.current = true;
      },
      resume: () => {
        pausedRef.current = false;
      },
      isPaused: () => pausedRef.current,
      specs,
      tableId,
    };
  }, [specs, tableId, notify]);
}
