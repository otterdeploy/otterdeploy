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
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import {
  backup,
  backupDestination,
  backupSchedule,
  databaseResource,
  project,
  resource,
} from "@otterdeploy/db/schema";

export interface DueSchedule {
  id: BackupScheduleId;
  organizationId: OrganizationId;
  projectId: ProjectId | null;
  sources: string[];
  cron: string;
  destinationId: BackupDestinationId;
  encryption: "none" | "aes-256-gcm" | "kms-managed" | "customer-key";
  keepDaily: number;
  retentionDays: number | null;
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
      destinationId: backupSchedule.destinationId,
      encryption: backupSchedule.encryption,
      keepDaily: backupSchedule.keepDaily,
      retentionDays: backupSchedule.retentionDays,
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

/** Org-agnostic destination read for system-side retention (no org filter). */
export async function getDestinationByIdWithSecret(
  id: BackupDestinationId,
): Promise<
  | {
      type: "s3" | "local" | "sftp";
      config: Record<string, unknown>;
      encryptedSecret: string | null;
    }
  | null
> {
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
  await db
    .update(backupSchedule)
    .set(fields)
    .where(eq(backupSchedule.id, scheduleId));
}

/** Resolve a schedule's source refs (resource ids or names) to database
 *  resource ids in the same org. */
export async function resolveScheduleSources(
  organizationId: OrganizationId,
  sources: string[],
): Promise<ResourceId[]> {
  if (sources.length === 0) return [];
  const rows = await db
    .select({ id: resource.id, name: resource.name })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(eq(project.organizationId, organizationId));
  const wanted = new Set(sources);
  return rows
    .filter((r) => wanted.has(r.id) || wanted.has(r.name))
    .map((r) => r.id);
}

/** Succeeded backups for a schedule, newest first — drives retention. */
export async function listScheduleBackups(
  scheduleId: BackupScheduleId,
): Promise<
  Array<{ id: BackupId; storagePath: string | null; completedAt: Date | null }>
> {
  return db
    .select({
      id: backup.id,
      storagePath: backup.storagePath,
      completedAt: backup.completedAt,
    })
    .from(backup)
    .where(and(eq(backup.scheduleId, scheduleId), eq(backup.status, "succeeded")))
    .orderBy(desc(backup.completedAt));
}

export async function deleteBackupRow(backupId: BackupId): Promise<void> {
  await db.delete(backup).where(eq(backup.id, backupId));
}

// ─── Schedule CRUD (org-scoped) ──────────────────────────────────────────

export async function createScheduleRecord(input: {
  organizationId: OrganizationId;
  name: string;
  sources: string[];
  cron: string;
  destinationId: BackupDestinationId;
  projectId?: ProjectId | null;
  keepDaily: number;
  retentionDays: number | null;
  encryption: "none" | "aes-256-gcm";
  enabled: boolean;
}): Promise<typeof backupSchedule.$inferSelect> {
  const [row] = await db
    .insert(backupSchedule)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      sources: input.sources,
      cron: input.cron,
      destinationId: input.destinationId,
      projectId: input.projectId ?? null,
      keepDaily: input.keepDaily,
      retentionDays: input.retentionDays,
      encryption: input.encryption,
      enabled: input.enabled,
    })
    .returning();
  if (!row) throw new Error("createScheduleRecord: insert returned no rows");
  return row;
}

export async function updateScheduleRecord(input: {
  organizationId: OrganizationId;
  id: BackupScheduleId;
  name?: string;
  sources?: string[];
  cron?: string;
  keepDaily?: number;
  retentionDays?: number | null;
  enabled?: boolean;
}): Promise<typeof backupSchedule.$inferSelect | null> {
  const patch: Partial<typeof backupSchedule.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.sources !== undefined) patch.sources = input.sources;
  if (input.cron !== undefined) {
    patch.cron = input.cron;
    // Recompute on next tick.
    patch.nextRunAt = null;
  }
  if (input.keepDaily !== undefined) patch.keepDaily = input.keepDaily;
  if (input.retentionDays !== undefined)
    patch.retentionDays = input.retentionDays;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const [row] = await db
    .update(backupSchedule)
    .set(patch)
    .where(
      and(
        eq(backupSchedule.id, input.id),
        eq(backupSchedule.organizationId, input.organizationId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteScheduleRecord(input: {
  organizationId: OrganizationId;
  id: BackupScheduleId;
}): Promise<boolean> {
  const [row] = await db
    .delete(backupSchedule)
    .where(
      and(
        eq(backupSchedule.id, input.id),
        eq(backupSchedule.organizationId, input.organizationId),
      ),
    )
    .returning({ id: backupSchedule.id });
  return Boolean(row);
}
