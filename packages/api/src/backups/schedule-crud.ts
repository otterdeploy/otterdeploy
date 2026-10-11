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

import { nextCronFire } from "../lib/cron";

/** The operator-editable schedule fields, shared by create (all required)
 *  and update (all optional via Partial). */
interface ScheduleFields {
  name: string;
  sources: string[];
  cron: string;
  destinationIds: BackupDestinationId[];
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
}

/**
 * When a schedule fires first, armed when it is written. Leaving it null for
 * the scheduler's next tick to fill meant a new (or re-timed) schedule showed
 * no next run until that tick and a reload. Null only for a cron that cannot
 * fire, which the contract already refuses. The cron parser takes a Date.
 */
function firstFireAt(cron: string): Date | null {
  const next = nextCronFire(cron, new Date());
  return next.isOk() ? next.value : null;
}

export async function createScheduleRecord(
  input: ScheduleFields & {
    organizationId: OrganizationId;
    projectId?: ProjectId | null;
  },
): Promise<typeof backupSchedule.$inferSelect> {
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
      nextRunAt: firstFireAt(input.cron),
    })
    .returning();
  if (!row) throw new Error("createScheduleRecord: insert returned no rows");
  return row;
}

export async function updateScheduleRecord(
  input: Partial<ScheduleFields> & {
    organizationId: OrganizationId;
    id: BackupScheduleId;
  },
): Promise<typeof backupSchedule.$inferSelect | null> {
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
  // An edited cron fires on its new timing from now.
  if (input.cron !== undefined) patch.nextRunAt = firstFireAt(input.cron);

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
