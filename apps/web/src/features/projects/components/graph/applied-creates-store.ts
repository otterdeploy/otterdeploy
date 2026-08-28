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
 * source and unmounts, then remounts when the resource arrives. That's the
 * disappear/reappear.
 *
 * Discard has no such gap (the resource never lands, and we *want* the ghost
 * gone immediately), so we can't bridge by simply making ghosts sticky. The
 * distinguishing signal is the Deploy action itself: the pending-changes bar
 * records the create keys it just applied here, the graph keeps those ghosts
 * mounted until the matching resource appears, then clears them. Discard never
 * records, so its ghosts drop the instant diff drops them.
 *
 * Keys are `${resource}:${name}`. The same id the graph node carries.
 *
 * Each key carries the change's `details` payload alongside it. Without that
 * the bridged ghost was rebuilt from the key string ALONE, so a stack that had
 * been showing its four member cards and its template logo degraded, the
 * instant Deploy was pressed, into an empty "No services parsed yet" box under
 * a generic icon: the graph appearing to forget what it had just been told.
 */

import type { JsonObject } from "@otterdeploy/shared/json";

import { useSyncExternalStore } from "react";

/** A recorded create: when it stops being bridged, and what the ghost should
 *  render meanwhile. */
interface Recorded {
  expiry: number;
  details: JsonObject | undefined;
}

/** Safety net: evict a recorded key after this long even if the resource never
 *  lands (failed reconcile, out-of-band deletion), so a ghost can't get stuck. */
const TTL_MS = 30_000;

// projectId → (key → what was recorded for it)
const store = new Map<string, Map<string, Recorded>>();
// Cached immutable snapshots so useSyncExternalStore's getSnapshot is stable
// between mutations (returning a fresh Set each call would loop forever).
const snapshots = new Map<string, AppliedCreates>();
const listeners = new Set<() => void>();

/** key → the create's `details`, or undefined when the change carried none. */
export type AppliedCreates = ReadonlyMap<string, JsonObject | undefined>;

const EMPTY: AppliedCreates = new Map();

function rebuild(projectId: string) {
  const m = store.get(projectId);
  if (!m || m.size === 0) {
    snapshots.set(projectId, EMPTY);
    return;
  }
  const now = Date.now();
  const out = new Map<string, JsonObject | undefined>();
  for (const [k, rec] of m) if (rec.expiry > now) out.set(k, rec.details);
  snapshots.set(projectId, out.size === 0 ? EMPTY : out);
}

function emit(projectId: string) {
  rebuild(projectId);
  for (const l of listeners) l();
}

/** Record the creates the operator just Deployed for this project, each with
 *  the `details` its ghost was rendering, so the bridged ghost stays the node
 *  the operator was already looking at. */
export function markAppliedCreates(
  projectId: string,
  entries: ReadonlyArray<{ key: string; details: JsonObject | undefined }>,
) {
  if (entries.length === 0) return;
  let m = store.get(projectId);
  if (!m) {
    m = new Map();
    store.set(projectId, m);
  }
  const expiry = Date.now() + TTL_MS;
  for (const e of entries) m.set(e.key, { expiry, details: e.details });
  emit(projectId);
  // Safety eviction so a ghost can't outlive a reconcile that never lands.
  setTimeout(() => {
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
  }, TTL_MS + 100);
}

/** Drop a key once its real resource has landed in the collection. */
export function clearAppliedCreate(projectId: string, key: string) {
  const m = store.get(projectId);
  if (m?.delete(key)) emit(projectId);
}

/**
 * Drop EVERY recorded create for a project. Called on Discard: discard removes
 * the pending changes from the manifest, so the diff stops reporting them, but
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

function getSnapshot(projectId: string): AppliedCreates {
  return snapshots.get(projectId) ?? EMPTY;
}

/** Subscribe a graph to the creates awaiting their resource to land. */
export function useAppliedCreates(projectId: string): AppliedCreates {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => getSnapshot(projectId),
    () => EMPTY,
  );
}
