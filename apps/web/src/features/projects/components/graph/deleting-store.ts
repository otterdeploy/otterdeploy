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
 * Keys are `${kind}:${name}`. The same id the graph node carries. There is no
 * payload: a marked key is the whole message. Mechanics come from
 * ./intent-store, shared with the applied-creates bridge.
 */

import { createIntentStore, type IntentMap } from "./intent-store";

/** Backstop for a delete whose result never arrives (a dropped connection, a
 *  closed laptop). Generous: a real stack teardown can run for minutes, and a
 *  node that stops looking doomed while it is still being destroyed is the
 *  worse lie. */
const TTL_MS = 600_000;

const store = createIntentStore<undefined>(TTL_MS);

/** Mark node keys as being torn down right now. */
export function markDeleting(projectId: string, keys: readonly string[]) {
  store.mark(
    projectId,
    keys.map((key) => ({ key, value: undefined })),
  );
}

/** Drop a mark: the resource is gone, or the delete failed and it isn't. */
export function clearDeleting(projectId: string, key: string) {
  store.clear(projectId, key);
}

/** The marks, keyed by node id. The values carry nothing: a key's presence is
 *  the whole message, so read this with `has`/`size`/`keys()`. */
export type DeletingMarks = IntentMap<undefined>;

/** Subscribe a graph to the resources currently being torn down. */
export function useDeleting(projectId: string): DeletingMarks {
  return store.use(projectId);
}
