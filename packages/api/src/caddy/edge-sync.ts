/**
 * The control plane's edge reload queue.
 *
 * Route writers used to `await reconcile()` before answering, which held a
 * domain add for the whole Caddy reload (over 20 s on a real install). They
 * now write the row, mark it pending (./edge-state.ts), call
 * {@link queueEdgeReload} and answer. The reload runs here, behind the
 * response, and settles the row `synced` or `failed`; the row change rides
 * the project event stream to the UI.
 *
 * One reload at a time, coalesced: a request that arrives while one is
 * running queues exactly one more, shared by every request that arrives
 * before it starts. That follow-up is what keeps a concurrent write from
 * being lost: the running reload may have read the routes before that write
 * landed, the follow-up reads them after. The edge watch (./edge-watch.ts)
 * goes through the same queue, so a drift reconcile and a write never load
 * Caddy concurrently.
 *
 * Durability is the row, not this queue. The queue lives in memory; if the
 * process dies first, the route is still in the database (and still
 * `pending`), and the edge watch reconciles it on its first tick after boot
 * ("never-loaded"), or within one tick if the database moved past what was
 * last loaded ("routes-changed"). A reload that fails is retried the same
 * way, with the watch's backoff.
 */
import { Result } from "better-result";
import { log } from "evlog";

import type { ProxyRouteRecord } from "./queries";
import type { ReconcileResult } from "./reconciler";

import { markRoutesEdgePending, type EdgeReloadTarget } from "./edge-state";
import { reconcile } from "./index";

type SyncOutcome = Result<ReconcileResult, Error>;

interface EdgeSyncDeps {
  reconcile: () => Promise<ReconcileResult>;
}

export interface EdgeSync {
  /** Ask for a reload that starts after this call. Resolves with that
   *  reload's outcome; never rejects. */
  request(): Promise<SyncOutcome>;
  /** Resolves once nothing is running or queued (tests, shutdown). */
  idle(): Promise<void>;
}

export function createEdgeSync(deps: EdgeSyncDeps): EdgeSync {
  let running: Promise<SyncOutcome> | null = null;
  let queued: Promise<SyncOutcome> | null = null;

  const run = (): Promise<SyncOutcome> =>
    Result.tryPromise({
      try: deps.reconcile,
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).then((outcome) => {
      if (outcome.isErr()) {
        log.error({ caddy: { step: "edge-sync", status: "failed", error: outcome.error.message } });
      } else if (outcome.value.loadError) {
        log.error({
          caddy: { step: "edge-sync", status: "load-failed", error: outcome.value.loadError },
        });
      }
      return outcome;
    });

  const start = (): Promise<SyncOutcome> => {
    const current = run().then((outcome) => {
      running = null;
      return outcome;
    });
    running = current;
    return current;
  };

  return {
    request() {
      if (!running) return start();
      // A reload is already in flight: it may have read the routes before the
      // caller's write, so ride (or open) the one queued behind it.
      if (queued) return queued;
      const next = running.then(() => {
        queued = null;
        return start();
      });
      queued = next;
      return next;
    },
    async idle() {
      while (running || queued) await (queued ?? running);
    },
  };
}

/**
 * Whether this process owns the control-plane edge. Only the server reaches
 * Caddy's admin socket; the build worker also writes routes (a git compose
 * stack's exposure) and queues reloads that cannot land there, and those
 * failures say nothing about the route. So only the owner records a failed
 * reload on the rows; anywhere else a row stays pending for the owner's edge
 * watch, which reconciles it within a tick ("routes-changed").
 */
let ownsEdge = false;

/** Called once by the server at boot, beside the edge watch. */
export function claimEdgeOwnership(): void {
  ownsEdge = true;
}

/** The process-wide queue. */
const controlPlaneEdgeSync = createEdgeSync({
  reconcile: () => reconcile(undefined, { recordFailures: ownsEdge }),
});

/** Queue a reload of the control-plane edge (see the module comment). */
export function requestEdgeSync(): Promise<SyncOutcome> {
  return controlPlaneEdgeSync.request();
}

/** Fire-and-forget form for route writers: the row is already written and
 *  marked pending, so nothing about the response depends on the reload. */
export function queueEdgeReload(): void {
  void controlPlaneEdgeSync.request();
}

/**
 * What a route writer calls after its write: mark the routes it changed
 * pending, queue the reload, and hand back the marked rows so the response
 * already says "pending". Awaits only the mark (one UPDATE), never the reload.
 */
export async function queueRouteReload(target: EdgeReloadTarget): Promise<ProxyRouteRecord[]> {
  const marked = await markRoutesEdgePending(target);
  queueEdgeReload();
  return marked;
}

/** {@link queueRouteReload} for one route, handing back the marked row (or
 *  the row as given, if it vanished meanwhile). */
export async function queueReloadOf(route: ProxyRouteRecord): Promise<ProxyRouteRecord> {
  const [marked] = await queueRouteReload({ routeIds: [route.id] });
  return marked ?? route;
}

/** Resolves once the queued reloads have run. For tests. */
export function edgeSyncIdle(): Promise<void> {
  return controlPlaneEdgeSync.idle();
}
