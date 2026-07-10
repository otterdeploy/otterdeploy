import { orgScopedProcedure, requirePermission } from "../..";
import { enforceProjectScope, enforceScheduleScope } from "../../authz/project-scope-guards";
import { createBackupRun, executeBackup } from "../../backups";
import {
  createScheduleRecord,
  deleteScheduleRecord,
  updateScheduleRecord,
} from "../../backups/schedule-crud";
import { classifyScheduleSources, getScheduleRunTarget } from "../../backups/schedule-db";
import { presentSchedule } from "./presenters";
import { listSchedules, scheduleDestinationNames } from "./service";

export const backupSchedulesRouter = {
  list: orgScopedProcedure.backups.schedules.list.handler(async ({ context }) => {
    const rows = await listSchedules({
      organizationId: context.activeOrganizationId,
    });
    return rows.map(presentSchedule);
  }),

  create: requirePermission({ backup: ["create"] }).backups.schedules.create.handler(
    async ({ input, context }) => {
      enforceProjectScope(context, input.projectId);
      const row = await createScheduleRecord({
        organizationId: context.activeOrganizationId,
        name: input.name,
        sources: input.sources,
        cron: input.cron,
        destinationIds: input.destinationIds,
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
      });
      context.log.set({ target: { type: "backup_schedule", id: row.id } });
      const [destinationNames, resolution] = await Promise.all([
        scheduleDestinationNames({
          organizationId: context.activeOrganizationId,
          ids: row.destinationIds,
        }),
        classifyScheduleSources(context.activeOrganizationId, row.sources),
      ]);
      return presentSchedule({
        schedule: row,
        destinationNames,
        missingSources: resolution.missing,
      });
    },
  ),

  update: requirePermission({ backup: ["update"] }).backups.schedules.update.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "backup_schedule", id: input.id } });
      await enforceScheduleScope(context, input.id);
      const row = await updateScheduleRecord({
        organizationId: context.activeOrganizationId,
        id: input.id,
        name: input.name,
        sources: input.sources,
        cron: input.cron,
        keepDaily: input.keepDaily,
        keepWeekly: input.keepWeekly,
        keepMonthly: input.keepMonthly,
        keepYearly: input.keepYearly,
        retentionDays: input.retentionDays,
        maxStorageGb: input.maxStorageGb,
        preHook: input.preHook,
        enabled: input.enabled,
      });
      if (!row) throw errors.NOT_FOUND();
      const [destinationNames, resolution] = await Promise.all([
        scheduleDestinationNames({
          organizationId: context.activeOrganizationId,
          ids: row.destinationIds,
        }),
        classifyScheduleSources(context.activeOrganizationId, row.sources),
      ]);
      return presentSchedule({
        schedule: row,
        destinationNames,
        missingSources: resolution.missing,
      });
    },
  ),

  // Manual trigger — enqueue + execute a run for each of the schedule's
  // database sources now. RBAC: backup:run.
  run: requirePermission({ backup: ["run"] }).backups.schedules.run.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "backup_schedule", id: input.id } });
      await enforceScheduleScope(context, input.id);
      const schedule = await getScheduleRunTarget({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!schedule) throw errors.NOT_FOUND();

      const { resolvedIds, missing } = await classifyScheduleSources(
        context.activeOrganizationId,
        schedule.sources,
      );
      // Orphaned schedule: nothing left to back up. Fail loudly (422 + the dead
      // refs) instead of returning a success envelope with `queued: 0` — the
      // latter reads as "ran fine" in the audit log and to the user.
      if (resolvedIds.length === 0) {
        throw errors.NO_SOURCES({
          message:
            schedule.sources.length === 0
              ? "This schedule has no source configured"
              : "This schedule's database source no longer exists",
          data: { missing },
        });
      }
      let queued = 0;
      for (const resourceId of resolvedIds) {
        for (const destinationId of schedule.destinationIds) {
          const id = await createBackupRun({
            organizationId: context.activeOrganizationId,
            source: { kind: "database", resourceId },
            destinationId,
            scheduleId: schedule.id,
            encryption: schedule.encryption === "aes-256-gcm" ? "aes-256-gcm" : "none",
            method: "manual-schedule",
          });
          queued += 1;
          // Run detached — status + logs observable via get/logs.
          void executeBackup(id);
        }
      }
      return { queued };
    },
  ),

  delete: requirePermission({ backup: ["delete"] }).backups.schedules.delete.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "backup_schedule", id: input.id } });
      await enforceScheduleScope(context, input.id);
      const ok = await deleteScheduleRecord({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!ok) throw errors.NOT_FOUND();
      return { ok: true };
    },
  ),
};
