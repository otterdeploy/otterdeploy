/**
 * Bridges the "apply gap" that made staged-create ghost nodes blink out and
 * back when the operator clicked Deploy.
 *
 * The graph renders a ghost node for every staged create reported by
 * manifest.diff. On Deploy, two independent data sources have to catch up:
 *   - manifest.diff (react-query)           → drops the create once state matches
 *   - the resource collection (TanStack DB) → gains the new resource row
 * They settle at different times. In the window where diff has already dropped
 * the create but the resource hasn't landed yet, the node belongs to neither
 * source and unmounts — then remounts when the resource arrives. That's the
 * disappear/reappear.
 *
 * Discard has no such gap (the resource never lands, and we *want* the ghost
 * gone immediately), so we can't bridge by simply making ghosts sticky. The
 * distinguishing signal is the Deploy action itself: the pending-changes bar
 * records the create keys it just applied here, the graph keeps those ghosts
 * mounted until the matching resource appears, then clears them. Discard never
 * records, so its ghosts drop the instant diff drops them.
 *
 * Keys are `${resource}:${name}` — the same id the graph node carries.
 */

import { useSyncExternalStore } from "react";

/** Safety net: evict a recorded key after this long even if the resource never
 *  lands (failed reconcile, out-of-band deletion), so a ghost can't get stuck. */
const TTL_MS = 30_000;

// projectId → (key → expiry timestamp)
const store = new Map<string, Map<string, number>>();
// Cached immutable snapshots so useSyncExternalStore's getSnapshot is stable
// between mutations (returning a fresh Set each call would loop forever).
const snapshots = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

const EMPTY: ReadonlySet<string> = new Set();

function rebuild(projectId: string) {
  const m = store.get(projectId);
  if (!m || m.size === 0) {
    snapshots.set(projectId, EMPTY);
    return;
  }
  const now = Date.now();
  const out = new Set<string>();
  for (const [k, exp] of m) if (exp > now) out.add(k);
  snapshots.set(projectId, out.size === 0 ? EMPTY : out);
}

function emit(projectId: string) {
  rebuild(projectId);
  for (const l of listeners) l();
}

/** Record create keys the operator just Deployed for this project. */
export function markAppliedCreates(projectId: string, keys: string[]) {
  if (keys.length === 0) return;
  let m = store.get(projectId);
  if (!m) {
    m = new Map();
    store.set(projectId, m);
  }
  const expiry = Date.now() + TTL_MS;
  for (const k of keys) m.set(k, expiry);
  emit(projectId);
  // Safety eviction so a ghost can't outlive a reconcile that never lands.
  setTimeout(() => {
    const cur = store.get(projectId);
    if (!cur) return;
    const now = Date.now();
    let changed = false;
    for (const [k, exp] of cur) {
      if (exp <= now) {
        cur.delete(k);
        changed = true;
      }
    }
    if (changed) emit(projectId);
  }, TTL_MS + 100);
}

/** Drop a key once its real resource has landed in the collection. */
export function clearAppliedCreate(projectId: string, key: string) {
  const m = store.get(projectId);
  if (m?.delete(key)) emit(projectId);
}

/**
 * Drop EVERY recorded create for a project. Called on Discard: discard removes
 * the pending changes from the manifest, so the diff stops reporting them — but
 * a create recorded by a prior Deploy (whose resource never landed, e.g. a
 * failed apply) has nothing to clear it, so the graph would keep re-synthesizing
 * its ghost from this store until the 30s TTL. Clearing here makes the ghost
 * vanish the instant the operator discards, not "eventually".
 */
export function clearAppliedCreatesForProject(projectId: string) {
  const m = store.get(projectId);
  if (m && m.size > 0) {
    m.clear();
    emit(projectId);
  }
}

function getSnapshot(projectId: string): ReadonlySet<string> {
  return snapshots.get(projectId) ?? EMPTY;
}

/** Subscribe a graph to the create keys awaiting their resource to land. */
export function useAppliedCreates(projectId: string): ReadonlySet<string> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => getSnapshot(projectId),
    () => EMPTY,
  );
}
