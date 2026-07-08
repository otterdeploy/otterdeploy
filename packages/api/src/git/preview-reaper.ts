/**
 * Idle-GC for PR previews — the enforcement behind the keep-alive/TTL control.
 * Every tick, tear down any ACTIVE, non-paused preview whose autoTeardownAt has
 * passed. A NULL autoTeardownAt = pinned (keep-alive) and is never reaped;
 * paused previews are already stopped, so they're skipped too. Runs as an
 * in-process interval in apps/server (like the other sweepers), not a BullMQ
 * job — packages/jobs can't import teardownPreview without a dependency cycle.
 */
import { db } from "@otterdeploy/db";
import { deployment, preview, project } from "@otterdeploy/db/schema/project";
import { env as serverEnv } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { and, eq, exists, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { log as globalLog } from "evlog";

import { markPreviewClosedById } from "../routers/project/queries";
import { teardownPreview } from "./preview-teardown";

/** Tear down previews past their idle deadline. Returns how many were reaped. */
export async function reapIdlePreviews(now: Date = new Date()): Promise<number> {
  // Idle teardown disabled globally — never reap, even previously-seeded
  // deadlines (matches the documented PREVIEW_IDLE_TEARDOWN_HOURS=0 contract).
  if (serverEnv.PREVIEW_IDLE_TEARDOWN_HOURS === 0) return 0;
  const due = await db
    .select({
      id: preview.id,
      projectId: preview.projectId,
      gitRepoId: preview.gitRepoId,
      slug: preview.slug,
      prNumber: preview.prNumber,
      projectSlug: project.slug,
    })
    .from(preview)
    .innerJoin(project, eq(project.id, preview.projectId))
    .where(
      and(
        eq(preview.state, "active"),
        eq(preview.paused, false),
        isNotNull(preview.autoTeardownAt),
        lt(preview.autoTeardownAt, now),
        // Don't reap a preview mid-build — the builder would recreate its
        // containers for a now-closed row (orphans with no routes).
        sql`not ${exists(
          db
            .select({ one: sql`1` })
            .from(deployment)
            .where(
              and(
                eq(deployment.previewId, preview.id),
                inArray(deployment.status, ["pending", "building"]),
              ),
            ),
        )}`,
      ),
    );
  let reaped = 0;
  for (const row of due) {
    // Close first so a mid-teardown crash can't leave it re-reaped every tick.
    await markPreviewClosedById(row.id);
    const torn = await Result.tryPromise({
      try: () =>
        teardownPreview({
          id: row.id,
          projectId: row.projectId,
          projectSlug: row.projectSlug,
          gitRepoId: row.gitRepoId,
          slug: row.slug,
          prNumber: row.prNumber,
        }),
      catch: (cause) => cause,
    });
    if (torn.isErr()) {
      globalLog.warn({ preview: { step: "idle-reap", id: row.id }, err: torn.error });
      continue;
    }
    globalLog.info({ preview: { step: "idle-reap", id: row.id, prNumber: row.prNumber } });
    reaped++;
  }
  return reaped;
}

/** Interval scheduler (default hourly), unref'd so it never holds the process. */
export function startPreviewReaper(intervalMs = 60 * 60 * 1000): () => void {
  void reapIdlePreviews();
  const timer = setInterval(() => {
    void reapIdlePreviews();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
