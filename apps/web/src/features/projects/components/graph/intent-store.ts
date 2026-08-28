/**
 * The machinery behind the graph's "intent" stores: what the operator has just
 * set in motion, held only long enough for the server-backed data to agree.
 *
 * The graph reads two sources that settle at different times — the manifest
 * diff (react-query) and the resource collection (TanStack DB) — and in the
 * window between them a node can belong to neither and blink out. Both bridges
 * over that window have the same shape: mark some node keys on an action, keep
 * them until the real data catches up, clear them on the true signal, and never
 * let a mark outlive a response that never came. Only the payload differs, so
 * that shape lives here once and the two stores (applied-creates, deleting) are
 * its callers, not its copies.
 *
 * A mark is intent, never truth. Every store built here clears on the real
 * signal first and falls back to the TTL only when nothing else arrives.
 */

import { useSyncExternalStore } from "react";

/** What a store hands its subscriber: marked key → whatever was recorded with
 *  it. A payload-free store records `undefined` and reads as a key set. */
export type IntentMap<T> = ReadonlyMap<string, T>;

export interface IntentStore<T> {
  /** Record keys, each with the payload its consumer will need meanwhile. */
  mark(projectId: string, entries: ReadonlyArray<{ key: string; value: T }>): void;
  /** Drop one key: the real signal arrived, or the action failed. */
  clear(projectId: string, key: string): void;
  /** Drop every key for a project. */
  clearAll(projectId: string): void;
  /** Subscribe a component to this project's marks. */
  use(projectId: string): IntentMap<T>;
}

interface Recorded<T> {
  expiry: number;
  value: T;
}

/**
 * Build one store. `ttlMs` is the backstop for the response that never comes,
 * so it is sized by how long the action it covers can honestly take.
 */
export function createIntentStore<T>(ttlMs: number): IntentStore<T> {
  // projectId → (key → what was recorded for it)
  const store = new Map<string, Map<string, Recorded<T>>>();
  // Cached immutable snapshots so useSyncExternalStore's getSnapshot is stable
  // between mutations (returning a fresh Map each call would loop forever).
  const snapshots = new Map<string, IntentMap<T>>();
  const listeners = new Set<() => void>();
  const EMPTY: IntentMap<T> = new Map<string, T>();

  function rebuild(projectId: string) {
    const m = store.get(projectId);
    if (!m || m.size === 0) {
      snapshots.set(projectId, EMPTY);
      return;
    }
    const now = Date.now();
    const out = new Map<string, T>();
    for (const [k, rec] of m) if (rec.expiry > now) out.set(k, rec.value);
    snapshots.set(projectId, out.size === 0 ? EMPTY : out);
  }

  function emit(projectId: string) {
    rebuild(projectId);
    for (const l of listeners) l();
  }

  function sweep(projectId: string) {
    const cur = store.get(projectId);
    if (!cur) return;
    const now = Date.now();
    let changed = false;
    for (const [k, rec] of cur) {
      if (rec.expiry <= now) {
        cur.delete(k);
        changed = true;
      }
    }
    if (changed) emit(projectId);
  }

  return {
    mark(projectId, entries) {
      if (entries.length === 0) return;
      let m = store.get(projectId);
      if (!m) {
        m = new Map();
        store.set(projectId, m);
      }
      const expiry = Date.now() + ttlMs;
      for (const e of entries) m.set(e.key, { expiry, value: e.value });
      emit(projectId);
      // Safety eviction, so a mark can't outlive the action it stands for.
      setTimeout(() => sweep(projectId), ttlMs + 100);
    },
    clear(projectId, key) {
      const m = store.get(projectId);
      if (m?.delete(key)) emit(projectId);
    },
    clearAll(projectId) {
      const m = store.get(projectId);
      if (m && m.size > 0) {
        m.clear();
        emit(projectId);
      }
    },
    use(projectId) {
      return useSyncExternalStore(
        (cb) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        () => snapshots.get(projectId) ?? EMPTY,
        () => EMPTY,
      );
    },
  };
}
