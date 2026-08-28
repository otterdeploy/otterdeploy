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
 *
 * The store mechanics (snapshots, TTL sweep, subscription) live in
 * ./intent-store, shared with the deleting store.
 */

import type { JsonObject } from "@otterdeploy/shared/json";

import { createIntentStore, type IntentMap } from "./intent-store";

/** Safety net: evict a recorded key after this long even if the resource never
 *  lands (failed reconcile, out-of-band deletion), so a ghost can't get stuck. */
const TTL_MS = 30_000;

/** key → the create's `details`, or undefined when the change carried none. */
export type AppliedCreates = IntentMap<JsonObject | undefined>;

const store = createIntentStore<JsonObject | undefined>(TTL_MS);

/** Record the creates the operator just Deployed for this project, each with
 *  the `details` its ghost was rendering, so the bridged ghost stays the node
 *  the operator was already looking at. */
export function markAppliedCreates(
  projectId: string,
  entries: ReadonlyArray<{ key: string; details: JsonObject | undefined }>,
) {
  store.mark(
    projectId,
    entries.map((e) => ({ key: e.key, value: e.details })),
  );
}

/** Drop a key once its real resource has landed in the collection. */
export function clearAppliedCreate(projectId: string, key: string) {
  store.clear(projectId, key);
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
  store.clearAll(projectId);
}

/** Subscribe a graph to the creates awaiting their resource to land. */
export function useAppliedCreates(projectId: string): AppliedCreates {
  return store.use(projectId);
}
