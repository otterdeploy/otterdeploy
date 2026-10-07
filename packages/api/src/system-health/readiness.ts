/**
 * Deep readiness probe for `/health`.
 *
 * The od-664 outage proved a static `{ok: true}` health payload is worse than
 * none: the server process was wedged for three days, project queries parked
 * on a never-settling await, while the compose healthcheck kept reading
 * "healthy" off a handler that touched nothing. This probe answers the
 * question the healthcheck is actually asking: can this process still reach
 * its database right now?
 *
 * It reads one row of the `resource` table, the table whose query path wedged
 * in that outage (project.list and project.resource.list hung; project-only
 * reads kept working), so a probe on a "safer" table would have stayed green
 * through that outage.
 *
 * It BYPASSES the Redis query cache. Every select goes through that cache with
 * a 60 s TTL, so a cached probe answered 200 off Redis for the whole of a 50 s
 * Postgres outage (Postgres paused). The cache has its own per-operation
 * deadline (packages/db/src/cache.ts), so it can no longer wedge a query the
 * way it did then; what readiness must not do is let a warm cache stand in for
 * the database.
 *
 * One probe query is in flight at a time: concurrent `/health` calls (the
 * compose healthcheck, an uptime monitor, a load balancer) share it, each with
 * its own deadline. A hung Postgres therefore holds one pooled connection for
 * health checks, not one per caller, and a slow one is not made slower by the
 * probe.
 */

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema";
import { withTimeout } from "@otterdeploy/shared/promise";
import { Result } from "better-result";

import { backupSchedulerLiveness } from "../backups/scheduler";

/** How long one `/health` call waits for the database. Inside the compose
 *  healthcheck's own 5 s timeout, so an outage reads as a 503 rather than a
 *  curl timeout, and short enough that a paused Postgres shows on /health
 *  within 15 s. A healthy local Postgres answers in ms. */
export const READINESS_TIMEOUT_MS = 3_000;

/** A shared probe query older than this is abandoned and a fresh one started,
 *  so a query the driver never settles cannot pin readiness to "not ready"
 *  after the database is back (Bun's own idle timeout normally fails a hung
 *  connection after 20 s, packages/db/src/client.ts). */
export const READINESS_QUERY_STALE_MS = 30_000;

export interface ReadinessResult {
  ok: boolean;
  /** Present only on failure: safe to expose, carries no query data. */
  error?: string;
  /** Backup-scheduler liveness (databasus-style): false when the scheduler
   *  started but hasn't ticked in 5 minutes. Folded into `ok` because a
   *  wedged scheduler means backups have silently stopped, and a process
   *  restart is exactly the remedy the healthcheck can trigger. */
  backupScheduler?: { healthy: boolean; lastTickAt: string | null };
}

interface DatabaseProbeOptions {
  /** One uncached round-trip to the database. */
  query: () => Promise<unknown>;
  timeoutMs: number;
  staleMs: number;
  /** Monotonic milliseconds. */
  now: () => number;
}

/** Can the database answer within the deadline? Single-flight, see above. */
export function createDatabaseProbe(
  options: DatabaseProbeOptions,
): () => Promise<Result<void, Error>> {
  let inFlight: { promise: Promise<unknown>; startedAt: number } | null = null;
  return async () => {
    if (inFlight === null || options.now() - inFlight.startedAt > options.staleMs) {
      const started = { promise: options.query(), startedAt: options.now() };
      inFlight = started;
      const clear = () => {
        if (inFlight === started) inFlight = null;
      };
      started.promise.then(clear, clear);
    }
    const current = inFlight.promise;
    return Result.tryPromise({
      try: async () => {
        await withTimeout(current, options.timeoutMs, "readiness probe query");
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
  };
}

const probeDatabase = createDatabaseProbe({
  // Async wrapper because a Drizzle builder is a thenable, not a Promise, and
  // it only dispatches when awaited.
  query: async () => db.select({ id: resource.id }).from(resource).limit(1).$withCache(false),
  timeoutMs: READINESS_TIMEOUT_MS,
  staleMs: READINESS_QUERY_STALE_MS,
  now: () => performance.now(),
});

export async function checkReadiness(): Promise<ReadinessResult> {
  const scheduler = backupSchedulerLiveness();
  const backupScheduler = {
    healthy: scheduler.healthy,
    lastTickAt: scheduler.lastTickAt?.toISOString() ?? null,
  };
  const database = await probeDatabase();
  if (database.isErr()) {
    return { ok: false, error: database.error.message, backupScheduler };
  }
  if (!scheduler.healthy) {
    return {
      ok: false,
      error: "backup scheduler has not ticked in over 5 minutes",
      backupScheduler,
    };
  }
  return { ok: true, backupScheduler };
}
