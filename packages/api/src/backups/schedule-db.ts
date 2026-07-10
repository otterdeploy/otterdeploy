/**
 * Schedule + retention queries for the backup engine. Split from `db.ts` (the
 * run/log write surface) to keep each file focused. The scheduler scans these
 * rows on a fixed tick; CRUD is org-scoped and called from the router.
 */
import type {
  BackupDestinationId,
  BackupId,
  BackupScheduleId,
  OrganizationId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  backup,
  backupDestination,
  backupSchedule,
  databaseResource,
  project,
  resource,
} from "@otterdeploy/db/schema";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";

export interface DueSchedule {
  id: BackupScheduleId;
  organizationId: OrganizationId;
  projectId: ProjectId | null;
  sources: string[];
  cron: string;
  destinationIds: BackupDestinationId[];
  encryption: "none" | "aes-256-gcm" | "kms-managed" | "customer-key";
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepYearly: number;
  retentionDays: number | null;
  maxStorageGb: number | null;
  preHook: string | null;
  // Null = freshly created, never scheduled — initialize without backfilling.
  nextRunAt: Date | null;
}

/** Enabled schedules whose nextRunAt is null (never computed) or in the past. */
export async function listDueSchedules(now: Date): Promise<DueSchedule[]> {
  const rows = await db
    .select({
      id: backupSchedule.id,
      organizationId: backupSchedule.organizationId,
      projectId: backupSchedule.projectId,
      sources: backupSchedule.sources,
      cron: backupSchedule.cron,
      destinationIds: backupSchedule.destinationIds,
      encryption: backupSchedule.encryption,
      keepDaily: backupSchedule.keepDaily,
      keepWeekly: backupSchedule.keepWeekly,
      keepMonthly: backupSchedule.keepMonthly,
      keepYearly: backupSchedule.keepYearly,
      retentionDays: backupSchedule.retentionDays,
      maxStorageGb: backupSchedule.maxStorageGb,
      preHook: backupSchedule.preHook,
      nextRunAt: backupSchedule.nextRunAt,
    })
    .from(backupSchedule)
    .where(
      and(
        eq(backupSchedule.enabled, true),
        or(isNull(backupSchedule.nextRunAt), lte(backupSchedule.nextRunAt, now)),
      ),
    );
  return rows as DueSchedule[];
}

/** A schedule's run inputs (sources + destination) for a manual "run now". */
export interface ScheduleRunTarget {
  id: BackupScheduleId;
  organizationId: OrganizationId;
  sources: string[];
  destinationIds: BackupDestinationId[];
  encryption: "none" | "aes-256-gcm" | "kms-managed" | "customer-key";
}

/** Org-scoped fetch of a single schedule's run inputs. */
export async function getScheduleRunTarget(input: {
  organizationId: OrganizationId;
  id: BackupScheduleId;
}): Promise<ScheduleRunTarget | null> {
  const [row] = await db
    .select({
      id: backupSchedule.id,
      organizationId: backupSchedule.organizationId,
      sources: backupSchedule.sources,
      destinationIds: backupSchedule.destinationIds,
      encryption: backupSchedule.encryption,
    })
    .from(backupSchedule)
    .where(
      and(eq(backupSchedule.id, input.id), eq(backupSchedule.organizationId, input.organizationId)),
    )
    .limit(1);
  return (row as ScheduleRunTarget | undefined) ?? null;
}

/** Org-agnostic destination read for system-side retention (no org filter). */
export async function getDestinationByIdWithSecret(id: BackupDestinationId): Promise<{
  type: "s3" | "local" | "sftp";
  config: Record<string, unknown>;
  encryptedSecret: string | null;
} | null> {
  const [row] = await db
    .select({
      type: backupDestination.type,
      config: backupDestination.config,
      encryptedSecret: backupDestination.encryptedSecret,
    })
    .from(backupDestination)
    .where(eq(backupDestination.id, id))
    .limit(1);
  return row ?? null;
}

export async function updateScheduleAfterRun(
  scheduleId: BackupScheduleId,
  fields: {
    lastRunAt: Date;
    lastRunStatus: "queued" | "running" | "succeeded" | "failed";
    nextRunAt: Date | null;
  },
): Promise<void> {
  await db.update(backupSchedule).set(fields).where(eq(backupSchedule.id, scheduleId));
}

/** Outcome of matching a schedule's source refs against live db resources. */
export interface ScheduleSourceResolution {
  /** Database resource ids the schedule can actually back up right now. */
  resolvedIds: ResourceId[];
  /** Source refs that no longer match any live database resource — the
   *  schedule was orphaned (its DB/volume was deleted out from under it). */
  missing: string[];
}

/** Pure matcher (no DB): partition `sources` against a set of live database
 *  resources. A ref counts as matched if *any* resource carries it as its id or
 *  name (name is not unique across projects, so a by-name ref can fan out to
 *  several); an unmatched ref is "missing" — its backing database is gone. */
export function partitionSources(
  sources: string[],
  dbResources: Array<{ id: ResourceId; name: string }>,
): ScheduleSourceResolution {
  if (sources.length === 0) return { resolvedIds: [], missing: [] };
  const wanted = new Set(sources);
  const resolvedIds: ResourceId[] = [];
  const matchedRefs = new Set<string>();
  for (const r of dbResources) {
    if (wanted.has(r.id)) {
      resolvedIds.push(r.id);
      matchedRefs.add(r.id);
    } else if (wanted.has(r.name)) {
      resolvedIds.push(r.id);
      matchedRefs.add(r.name);
    }
  }
  return { resolvedIds, missing: sources.filter((s) => !matchedRefs.has(s)) };
}

/** Match a schedule's source refs against the org's live database resources,
 *  partitioning them into what still resolves and what has gone missing. */
export async function classifyScheduleSources(
  organizationId: OrganizationId,
  sources: string[],
): Promise<ScheduleSourceResolution> {
  if (sources.length === 0) return { resolvedIds: [], missing: [] };
  const rows = await db
    .select({ id: resource.id, name: resource.name })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(eq(project.organizationId, organizationId));
  return partitionSources(sources, rows);
}

/** Resolve a schedule's source refs (resource ids or names) to database
 *  resource ids in the same org. Thin wrapper over `classifyScheduleSources`. */
export async function resolveScheduleSources(
  organizationId: OrganizationId,
  sources: string[],
): Promise<ResourceId[]> {
  return (await classifyScheduleSources(organizationId, sources)).resolvedIds;
}

/** Succeeded backups for a schedule, newest first — drives retention. */
export async function listScheduleBackups(scheduleId: BackupScheduleId): Promise<
  Array<{
    id: BackupId;
    destinationId: BackupDestinationId;
    storagePath: string | null;
    completedAt: Date | null;
    compressedSizeBytes: number | null;
  }>
> {
  return db
    .select({
      id: backup.id,
      destinationId: backup.destinationId,
      storagePath: backup.storagePath,
      completedAt: backup.completedAt,
      compressedSizeBytes: backup.compressedSizeBytes,
    })
    .from(backup)
    .where(and(eq(backup.scheduleId, scheduleId), eq(backup.status, "succeeded")))
    .orderBy(desc(backup.completedAt));
}

export async function deleteBackupRow(backupId: BackupId): Promise<void> {
  await db.delete(backup).where(eq(backup.id, backupId));
}
