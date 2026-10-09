/**
 * Edge config watch: notice when the control-plane Caddy is no longer running
 * the config this server last loaded into it, and reconcile.
 *
 * Routes reach Caddy only through its admin API (`/load`). Caddy keeps them in
 * memory and autosaves them to its state volume, and the compose service now
 * resumes that autosave on start (docker-compose.prod.yml, `--resume`). That
 * covers the common case. This watch covers the rest: an install whose compose
 * predates `--resume`, an autosave Caddy refused to resume (the edge then boots
 * from the stub Caddyfile, every route 503), a config replaced by hand, a
 * reconcile that failed while Caddy was down. Before it existed, a Caddy
 * restart left every app route 503 until someone restarted the server.
 *
 * Each tick reads `GET /config/` over the same admin socket and compares a hash
 * of it with the hash recorded right after the last successful load. A
 * difference (or no successful load yet) runs a full reconcile, which also
 * re-attaches the project networks a recreated edge loses.
 *
 * It also compares the routes the DATABASE holds with the ones last loaded.
 * Only this process can reach Caddy's admin socket, but routes
 * are written by others too: a git compose stack seeds its public routes from
 * the build worker, whose reconcile cannot load anything. That load failed
 * quietly, the stack log said "exposed publicly", and the host was never
 * served until some unrelated change made this process reconcile (kutt, umami,
 * docmost, immich: TLS handshake failing for the whole 20-45 min watch). The
 * database is the source of truth for routes, so the edge now converges on it
 * within one tick, whoever wrote the row. An admin API that
 * does not answer is left alone: Caddy is down or restarting (the next tick
 * sees it back), or wedged, which the reconcile path's own self-heal handles
 * when a load times out. Failed reconciles back off exponentially so a config
 * Caddy keeps rejecting is not reloaded every tick.
 */
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { log } from "evlog";
import { createHash } from "node:crypto";

import { runBackgroundPass } from "../lib/background-pass";
import { readCaddyConfig } from "./client";

/** How often the edge config is compared with the last load. One small GET
 *  over a local Unix socket; a restarted edge serves its routes again within
 *  about this long. */
export const EDGE_WATCH_INTERVAL_MS = 10_000;

/** Ceiling for the backoff after consecutive failed reconciles. */
export const EDGE_WATCH_MAX_BACKOFF_MS = 5 * 60_000;

export type EdgeWatchOutcome =
  | { kind: "in-sync" }
  | { kind: "unreachable"; error: string }
  | { kind: "busy" }
  | { kind: "desired-unreadable"; error: string }
  | { kind: "backoff"; retryInMs: number }
  | { kind: "reconciled"; reason: EdgeDriftReason }
  | { kind: "reconcile-failed"; reason: EdgeDriftReason; error: string; retryInMs: number };

/** Why a reconcile ran: nothing loaded yet since boot, the running config is
 *  not the one last loaded (a restart from the stub, a hand edit), or the
 *  routes in the database are not the ones last loaded (written by a process
 *  that cannot reach the edge, such as the build worker). */
export type EdgeDriftReason = "never-loaded" | "config-changed" | "routes-changed";

/** The full reconcile; resolves with `loadError` when Caddy refused it. */
type EdgeReconcile = () => Promise<{ loadError?: string }>;

/** The revision of the edge config the database describes right now (see
 *  `desiredEdgeRevision` in ./index.ts), or why it could not be read. */
type EdgeDesiredRevision = () => Promise<Result<string, Error>>;

interface EdgeWatchDeps {
  /** `GET /config/` text, or why the admin API did not answer. */
  readConfig: () => Promise<Result<string, Error>>;
  /** Monotonic milliseconds. */
  now: () => number;
  intervalMs?: number;
  maxBackoffMs?: number;
}

export interface EdgeWatch {
  /** Call right after a successful load: remembers what Caddy now runs, and
   *  the database revision that load was rendered from. */
  recordLoaded(desiredRevision: string): Promise<void>;
  /** One comparison, reconciling on drift. Never throws. The reconcile and
   *  the desired-revision read are passed in rather than imported: both live
   *  in ./index.ts, whose loader calls `recordLoaded`. */
  tick(reconcile: EdgeReconcile, readDesired: EdgeDesiredRevision): Promise<EdgeWatchOutcome>;
}

function configHash(config: string): string {
  return createHash("sha256").update(config).digest("hex");
}

export function createEdgeWatch(deps: EdgeWatchDeps): EdgeWatch {
  const intervalMs = deps.intervalMs ?? EDGE_WATCH_INTERVAL_MS;
  const maxBackoffMs = deps.maxBackoffMs ?? EDGE_WATCH_MAX_BACKOFF_MS;
  let loadedHash: string | null = null;
  let loadedDesired: string | null = null;
  let failures = 0;
  let retryAt = Number.NEGATIVE_INFINITY;
  let running = false;

  async function reconcileOnDrift(
    reconcile: EdgeReconcile,
    reason: EdgeDriftReason,
  ): Promise<EdgeWatchOutcome> {
    const reconciled = await Result.tryPromise({
      try: reconcile,
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    });
    const outcome = reconciled.isOk() ? (reconciled.value.loadError ?? null) : reconciled.error;
    if (outcome === null) {
      failures = 0;
      retryAt = Number.NEGATIVE_INFINITY;
      return { kind: "reconciled", reason };
    }
    failures += 1;
    const retryInMs = Math.min(intervalMs * 2 ** failures, maxBackoffMs);
    retryAt = deps.now() + retryInMs;
    return { kind: "reconcile-failed", reason, error: outcome, retryInMs };
  }

  /** Why the edge needs a reconcile, or null when it runs what the database
   *  describes. The database is read only when Caddy itself looks unchanged:
   *  any other answer already means a reconcile. */
  async function driftReason(
    runningHash: string,
    readDesired: EdgeDesiredRevision,
  ): Promise<Result<EdgeDriftReason | null, Error>> {
    if (loadedHash === null) return Result.ok("never-loaded");
    if (runningHash !== loadedHash) return Result.ok("config-changed");
    const desired = await readDesired();
    if (desired.isErr()) return Result.err(desired.error);
    return Result.ok(desired.value === loadedDesired ? null : "routes-changed");
  }

  return {
    async recordLoaded(desiredRevision) {
      loadedDesired = desiredRevision;
      const config = await deps.readConfig();
      // Unreadable right after a load: leave the old hash; the next tick sees
      // a difference and reconciles once more, which is harmless.
      if (config.isOk()) loadedHash = configHash(config.value);
    },
    async tick(reconcile, readDesired) {
      if (running) return { kind: "busy" };
      running = true;
      try {
        const config = await deps.readConfig();
        if (config.isErr()) return { kind: "unreachable", error: config.error.message };
        const reason = await driftReason(configHash(config.value), readDesired);
        if (reason.isErr()) return { kind: "desired-unreadable", error: reason.error.message };
        if (reason.value === null) return { kind: "in-sync" };
        const wait = retryAt - deps.now();
        if (wait > 0) return { kind: "backoff", retryInMs: wait };
        return await reconcileOnDrift(reconcile, reason.value);
      } finally {
        running = false;
      }
    },
  };
}

/** The control-plane edge: the Caddy this process loads over its admin API. */
export const controlPlaneEdgeWatch = createEdgeWatch({
  readConfig: () => readCaddyConfig(env.CADDY_ADMIN_URL),
  now: () => performance.now(),
});

/** Start the watch. Returns a stop handle, matching the other background
 *  services in apps/server/src/background-services.ts. Logs drift, each
 *  reconcile, and the edge going unreachable / coming back, not every tick. */
export function startEdgeWatch(
  reconcile: EdgeReconcile,
  readDesired: EdgeDesiredRevision,
): () => void {
  let lastKind: EdgeWatchOutcome["kind"] = "in-sync";
  const tick = async () => {
    const outcome = await controlPlaneEdgeWatch.tick(reconcile, readDesired);
    const changed = outcome.kind !== lastKind;
    lastKind = outcome.kind === "busy" ? lastKind : outcome.kind;
    if (outcome.kind === "reconciled") {
      log.info({ caddy: { step: "edge-watch", status: "reconciled", reason: outcome.reason } });
    } else if (outcome.kind === "reconcile-failed") {
      log.error({ caddy: { step: "edge-watch", status: "reconcile-failed", ...outcome } });
    } else if (changed && outcome.kind === "desired-unreadable") {
      log.warn({
        caddy: { step: "edge-watch", status: "desired-unreadable", error: outcome.error },
      });
    } else if (changed && outcome.kind === "unreachable") {
      log.warn({ caddy: { step: "edge-watch", status: "unreachable", error: outcome.error } });
    } else if (changed && outcome.kind === "in-sync") {
      log.info({ caddy: { step: "edge-watch", status: "in-sync" } });
    }
  };
  const interval = setInterval(() => runBackgroundPass("edge-watch", tick), EDGE_WATCH_INTERVAL_MS);
  return () => clearInterval(interval);
}
