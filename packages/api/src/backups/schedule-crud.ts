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

import { db } from "@otterdeploy/db";
import { backupSchedule } from "@otterdeploy/db/schema";
import { omitUndefined } from "@otterdeploy/shared/object";
import { and, eq } from "drizzle-orm";

export async function createScheduleRecord(input: {
  organizationId: OrganizationId;
  name: string;
  sources: string[];
  cron: string;
  destinationIds: BackupDestinationId[];
  projectId?: ProjectId | null;
  keepLast: number;
  keepHourly: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepYearly: number;
  retentionDays: number | null;
  maxStorageGb: number | null;
  preHook: string | null;
  encryption: "none" | "aes-256-gcm";
  enabled: boolean;
  maxRetries: number;
  verifyAfterBackup: boolean;
  overdueAfterHours: number | null;
}): Promise<typeof backupSchedule.$inferSelect> {
  const [row] = await db
    .insert(backupSchedule)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      sources: input.sources,
      cron: input.cron,
      destinationIds: input.destinationIds,
      projectId: input.projectId ?? null,
      keepLast: input.keepLast,
      keepHourly: input.keepHourly,
      keepDaily: input.keepDaily,
      keepWeekly: input.keepWeekly,
      keepMonthly: input.keepMonthly,
      keepYearly: input.keepYearly,
      retentionDays: input.retentionDays,
      maxStorageGb: input.maxStorageGb,
      preHook: input.preHook,
      encryption: input.encryption,
      enabled: input.enabled,
      maxRetries: input.maxRetries,
      verifyAfterBackup: input.verifyAfterBackup,
      overdueAfterHours: input.overdueAfterHours,
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
  destinationIds?: BackupDestinationId[];
  keepLast?: number;
  keepHourly?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepYearly?: number;
  retentionDays?: number | null;
  maxStorageGb?: number | null;
  preHook?: string | null;
  encryption?: "none" | "aes-256-gcm";
  enabled?: boolean;
  maxRetries?: number;
  verifyAfterBackup?: boolean;
  overdueAfterHours?: number | null;
}): Promise<typeof backupSchedule.$inferSelect | null> {
  const patch: Partial<typeof backupSchedule.$inferInsert> = omitUndefined({
    name: input.name,
    sources: input.sources,
    cron: input.cron,
    destinationIds: input.destinationIds,
    keepLast: input.keepLast,
    keepHourly: input.keepHourly,
    keepDaily: input.keepDaily,
    keepWeekly: input.keepWeekly,
    keepMonthly: input.keepMonthly,
    keepYearly: input.keepYearly,
    retentionDays: input.retentionDays,
    maxStorageGb: input.maxStorageGb,
    preHook: input.preHook,
    encryption: input.encryption,
    enabled: input.enabled,
    maxRetries: input.maxRetries,
    verifyAfterBackup: input.verifyAfterBackup,
    overdueAfterHours: input.overdueAfterHours,
  });
  // An edited cron recomputes its fire time on the next tick.
  if (input.cron !== undefined) patch.nextRunAt = null;

  const [row] = await db
    .update(backupSchedule)
    .set(patch)
    .where(
      and(eq(backupSchedule.id, input.id), eq(backupSchedule.organizationId, input.organizationId)),
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
      and(eq(backupSchedule.id, input.id), eq(backupSchedule.organizationId, input.organizationId)),
    )
    .returning({ id: backupSchedule.id });
  return Boolean(row);
}
