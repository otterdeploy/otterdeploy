/**
 * Deletion-side referential integrity for backup schedules.
 *
 * `backup_schedule.sources` is an FK-less jsonb array of resource ids OR names
 * (see backup.ts schema — a by-name ref can fan out to several same-named
 * databases). Because there is no FK, deleting the backing database used to
 * silently orphan the schedule: the dead ref lingered, and on its next tick the
 * schedule resolved to zero sources — recorded `failed`, and a manual "run now"
 * enqueued nothing (queued:0). This module closes that gap on the deletion side:
 * when a database resource is removed, prune it from every schedule that
 * referenced it, disable any schedule left with no live source, and emit a
 * `backup.orphaned` notification for each schedule so disabled.
 *
 * The write-time validation in the router covered adding a bad ref; this covers
 * a good ref going bad underneath the schedule.
 */
import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupSchedule, databaseResource, project, resource } from "@otterdeploy/db/schema";

import { listStackDatabaseResources } from "./stack";
import { and, eq, sql } from "drizzle-orm";
import { log } from "evlog";

import { emitPlatformEvent } from "../notifications/emit";
import { partitionSources } from "./schedule-db";

/**
 * Pure decision for one schedule: given its current `sources` and the set of
 * live database resources, return the pruned source list plus whether the
 * schedule changed and whether it should be disabled (no source can ever run).
 *
 * A by-name ref survives iff a same-named sibling is still live — that is
 * exactly `partitionSources`' matching rule, so we reuse it as the authority.
 */
export function planSchedulePrune(
  sources: string[],
  live: Array<{ id: ResourceId; name: string }>,
): { nextSources: string[]; changed: boolean; disable: boolean } {
  // Kind is irrelevant to which refs are *missing* (this only prunes dead
  // refs), so tag every candidate `database` for the pure matcher.
  const { missing } = partitionSources(
    sources,
    live.map((r) => ({ ...r, kind: "database" as const })),
  );
  if (missing.length === 0) {
    return { nextSources: sources, changed: false, disable: false };
  }
  const missingSet = new Set(missing);
  const nextSources = sources.filter((s) => !missingSet.has(s));
  return { nextSources, changed: true, disable: nextSources.length === 0 };
}

/**
 * Prune a now-deleted database resource from every backup schedule that
 * referenced it (by id or name), disabling any schedule left sourceless.
 *
 * MUST be called AFTER the resource row is deleted so the live set reflects
 * reality — otherwise a by-name ref whose only backing resource is the one
 * being deleted would look resolvable and survive. Never throws: a failure here
 * leaves the pre-existing orphan (the scanner still records it `failed`), so it
 * must not block the resource deletion that triggered it.
 */
export async function pruneSchedulesForDeletedResource(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  resourceName: string;
}): Promise<void> {
  const { organizationId, resourceId, resourceName } = input;
  try {
    // Candidate schedules only: those whose sources array contains the deleted
    // resource's id or name. jsonb containment keeps the scan org-scoped and
    // cheap, and means a deletion that no schedule referenced does one query.
    const candidates = await db
      .select({ id: backupSchedule.id, name: backupSchedule.name, sources: backupSchedule.sources })
      .from(backupSchedule)
      .where(
        and(
          eq(backupSchedule.organizationId, organizationId),
          sql`(${backupSchedule.sources} @> ${JSON.stringify([resourceId])}::jsonb or ${backupSchedule.sources} @> ${JSON.stringify([resourceName])}::jsonb)`,
        ),
      );
    if (candidates.length === 0) return;

    // Live databases in the org, post-deletion — the authority for what a ref
    // still resolves to (id or name, matching the scheduler). Managed database
    // resources AND compose-stack DB services, so a stack-backed schedule isn't
    // pruned as orphaned just because its source isn't a `database_resource`.
    const [dbRows, stackRows] = await Promise.all([
      db
        .select({ id: resource.id, name: resource.name })
        .from(resource)
        .innerJoin(project, eq(project.id, resource.projectId))
        .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
        .where(eq(project.organizationId, organizationId)),
      listStackDatabaseResources(organizationId),
    ]);
    const live = [...dbRows, ...stackRows];

    for (const schedule of candidates) {
      const { nextSources, changed, disable } = planSchedulePrune(schedule.sources, live);
      if (!changed) continue;
      await db
        .update(backupSchedule)
        .set({
          sources: nextSources,
          // A schedule with no resolvable source can never run — disable it so
          // the scanner skips it and the UI shows it stopped, not silently
          // broken. Re-enabling is a deliberate user action once a source is
          // re-added.
          ...(disable ? { enabled: false } : {}),
        })
        .where(eq(backupSchedule.id, schedule.id));
      log.info({
        backups: {
          scheduleCleanup: schedule.id,
          removed: schedule.sources.length - nextSources.length,
          disabled: disable,
        },
      });
      // Only the disable case is notification-worthy: the schedule lost its
      // last live source and can no longer produce a backup until repaired.
      // A partial prune (some sources survive) leaves it functional, so it
      // stays quiet to avoid noise. Best-effort — never blocks the cleanup.
      if (disable) {
        await emitPlatformEvent({
          organizationId,
          eventId: "backup.orphaned",
          title: `Backup schedule "${schedule.name}" was disabled`,
          message: `Its last database source (${resourceName}) was deleted, so the schedule can no longer run. Re-point it at a live database and re-enable it.`,
          data: { schedule: schedule.name, deletedSource: resourceName },
        });
      }
    }
  } catch (cause) {
    log.warn({
      backups: { scheduleCleanup: "error", resource: resourceId },
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
