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
 * re-attaches the project networks a recreated edge loses. An admin API that
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
  | { kind: "backoff"; retryInMs: number }
  | { kind: "reconciled"; reason: EdgeDriftReason }
  | { kind: "reconcile-failed"; reason: EdgeDriftReason; error: string; retryInMs: number };

/** Why a reconcile ran: nothing loaded yet since boot, or the running config
 *  is not the one last loaded (a restart from the stub, a hand edit). */
export type EdgeDriftReason = "never-loaded" | "config-changed";

/** The full reconcile; resolves with `loadError` when Caddy refused it. */
type EdgeReconcile = () => Promise<{ loadError?: string }>;

interface EdgeWatchDeps {
  /** `GET /config/` text, or why the admin API did not answer. */
  readConfig: () => Promise<Result<string, Error>>;
  /** Monotonic milliseconds. */
  now: () => number;
  intervalMs?: number;
  maxBackoffMs?: number;
}

export interface EdgeWatch {
  /** Call right after a successful load: remembers what Caddy now runs. */
  recordLoaded(): Promise<void>;
  /** One comparison, reconciling on drift. Never throws. The reconcile is
   *  passed in rather than imported: it lives in ./index.ts, whose loader
   *  calls `recordLoaded`. */
  tick(reconcile: EdgeReconcile): Promise<EdgeWatchOutcome>;
}

function configHash(config: string): string {
  return createHash("sha256").update(config).digest("hex");
}

export function createEdgeWatch(deps: EdgeWatchDeps): EdgeWatch {
  const intervalMs = deps.intervalMs ?? EDGE_WATCH_INTERVAL_MS;
  const maxBackoffMs = deps.maxBackoffMs ?? EDGE_WATCH_MAX_BACKOFF_MS;
  let loadedHash: string | null = null;
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

  return {
    async recordLoaded() {
      const config = await deps.readConfig();
      // Unreadable right after a load: leave the old hash; the next tick sees
      // a difference and reconciles once more, which is harmless.
      if (config.isOk()) loadedHash = configHash(config.value);
    },
    async tick(reconcile) {
      if (running) return { kind: "busy" };
      running = true;
      try {
        const config = await deps.readConfig();
        if (config.isErr()) return { kind: "unreachable", error: config.error.message };
        if (loadedHash !== null && configHash(config.value) === loadedHash) {
          return { kind: "in-sync" };
        }
        const wait = retryAt - deps.now();
        if (wait > 0) return { kind: "backoff", retryInMs: wait };
        return await reconcileOnDrift(
          reconcile,
          loadedHash === null ? "never-loaded" : "config-changed",
        );
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
export function startEdgeWatch(reconcile: EdgeReconcile): () => void {
  let lastKind: EdgeWatchOutcome["kind"] = "in-sync";
  const tick = async () => {
    const outcome = await controlPlaneEdgeWatch.tick(reconcile);
    const changed = outcome.kind !== lastKind;
    lastKind = outcome.kind === "busy" ? lastKind : outcome.kind;
    if (outcome.kind === "reconciled") {
      log.info({ caddy: { step: "edge-watch", status: "reconciled", reason: outcome.reason } });
    } else if (outcome.kind === "reconcile-failed") {
      log.error({ caddy: { step: "edge-watch", status: "reconcile-failed", ...outcome } });
    } else if (changed && outcome.kind === "unreachable") {
      log.warn({ caddy: { step: "edge-watch", status: "unreachable", error: outcome.error } });
    } else if (changed && outcome.kind === "in-sync") {
      log.info({ caddy: { step: "edge-watch", status: "in-sync" } });
    }
  };
  const interval = setInterval(() => runBackgroundPass("edge-watch", tick), EDGE_WATCH_INTERVAL_MS);
  return () => clearInterval(interval);
}
