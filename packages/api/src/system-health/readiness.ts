/**
 * Deep readiness probe for `/health`.
 *
 * The od-664 outage proved a static `{ok: true}` health payload is worse than
 * none: the server process was wedged for three days, project queries parked
 * on a never-settling await, while the compose healthcheck kept reading
 * "healthy" off a handler that touched nothing. This probe answers the
 * question the healthcheck is actually asking: can this process still serve a
 * real query?
 *
 * The probe runs the same path a product read runs. A Drizzle select on the
 * `resource` table, which flows through the global Redis query cache and then
 * Postgres. That table is chosen deliberately: it is the one whose query path
 * wedged in od-664 (project.list and project.resource.list hung; project-only
 * reads kept working), so a probe on a "safer" table would have stayed green
 * through the entire outage.
 *
 * Cheap enough for a 10s healthcheck interval: one indexed LIMIT 1 read, and
 * the cache layer in front of it absorbs most of those.
 */

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema";
import { withTimeout } from "@otterdeploy/shared/promise";

import { backupSchedulerLiveness } from "../backups/scheduler";

const READINESS_TIMEOUT_MS = 5_000;

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

export async function checkReadiness(): Promise<ReadinessResult> {
  const scheduler = backupSchedulerLiveness();
  const backupScheduler = {
    healthy: scheduler.healthy,
    lastTickAt: scheduler.lastTickAt?.toISOString() ?? null,
  };
  try {
    // Async wrapper because a Drizzle builder is a thenable, not a Promise,
    // and crucially it only dispatches when awaited, which must happen INSIDE
    // the race so the deadline covers the query itself.
    await withTimeout(
      (async () => {
        await db.select({ id: resource.id }).from(resource).limit(1);
      })(),
      READINESS_TIMEOUT_MS,
      "readiness probe query",
    );
    if (!scheduler.healthy) {
      return {
        ok: false,
        error: "backup scheduler has not ticked in over 5 minutes",
        backupScheduler,
      };
    }
    return { ok: true, backupScheduler };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      backupScheduler,
    };
  }
}
