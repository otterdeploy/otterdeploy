/**
 * Resources whose teardown is running right now, so the graph can show the
 * work instead of making the operator watch a modal spinner.
 *
 * A compose delete tears down every container in the stack, which takes as long
 * as it takes. Holding the confirm dialog open with a "Deleting…" button for
 * that whole time makes the operator wait on a machine that no longer needs
 * them: the decision was made the moment they typed the name. So the dialog
 * closes at once, the node is marked here, and it wears the destructive comet
 * (see PendingComet / PendingMark) until the resource actually leaves the
 * collection — at which point the node goes with it.
 *
 * The mark is intent, never truth: it is cleared when the resource is gone
 * (the real signal), when the delete fails (nothing was destroyed, so the node
 * must look alive again), and by a TTL for the response that never comes.
 *
 * Keys are `${kind}:${name}`. The same id the graph node carries.
 */

import { useSyncExternalStore } from "react";

/** Backstop for a delete whose result never arrives (a dropped connection, a
 *  closed laptop). Generous: a real stack teardown can run for minutes, and a
 *  node that stops looking doomed while it is still being destroyed is the
 *  worse lie. */
const TTL_MS = 600_000;

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

/** Mark node keys as being torn down right now. */
export function markDeleting(projectId: string, keys: readonly string[]) {
  if (keys.length === 0) return;
  let m = store.get(projectId);
  if (!m) {
    m = new Map();
    store.set(projectId, m);
  }
  const expiry = Date.now() + TTL_MS;
  for (const k of keys) m.set(k, expiry);
  emit(projectId);
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

/** Drop a mark: the resource is gone, or the delete failed and it isn't. */
export function clearDeleting(projectId: string, key: string) {
  const m = store.get(projectId);
  if (m?.delete(key)) emit(projectId);
}

function getSnapshot(projectId: string): ReadonlySet<string> {
  return snapshots.get(projectId) ?? EMPTY;
}

/** Subscribe a graph to the resources currently being torn down. */
export function useDeleting(projectId: string): ReadonlySet<string> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => getSnapshot(projectId),
    () => EMPTY,
  );
}
