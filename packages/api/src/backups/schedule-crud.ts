/**
 * Org-scoped schedule CRUD (create / update / delete records). Split from
 * `schedule-db.ts` (the scanner + retention read surface) to keep each file
 * focused and within the line budget. Called from the backups router.
 */
import type {
  BackupDestinationId,
  BackupScheduleId,
  OrganizationId,
  ProjectId,
} from "@otterdeploy/shared/id";
import { and, eq } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { backupSchedule } from "@otterdeploy/db/schema";

export async function createScheduleRecord(input: {
  organizationId: OrganizationId;
  name: string;
  sources: string[];
  cron: string;
  destinationId: BackupDestinationId;
  projectId?: ProjectId | null;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepYearly: number;
  retentionDays: number | null;
  maxStorageGb: number | null;
  preHook: string | null;
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
      keepWeekly: input.keepWeekly,
      keepMonthly: input.keepMonthly,
      keepYearly: input.keepYearly,
      retentionDays: input.retentionDays,
      maxStorageGb: input.maxStorageGb,
      preHook: input.preHook,
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
  keepWeekly?: number;
  keepMonthly?: number;
  keepYearly?: number;
  retentionDays?: number | null;
  maxStorageGb?: number | null;
  preHook?: string | null;
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
  if (input.keepWeekly !== undefined) patch.keepWeekly = input.keepWeekly;
  if (input.keepMonthly !== undefined) patch.keepMonthly = input.keepMonthly;
  if (input.keepYearly !== undefined) patch.keepYearly = input.keepYearly;
  if (input.retentionDays !== undefined)
    patch.retentionDays = input.retentionDays;
  if (input.maxStorageGb !== undefined) patch.maxStorageGb = input.maxStorageGb;
  if (input.preHook !== undefined) patch.preHook = input.preHook;
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
