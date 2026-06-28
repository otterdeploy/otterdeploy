import { orgScopedProcedure, requirePermission } from "../..";
import { enforceProjectScope, enforceScheduleScope } from "../../authz/project-scope-guards";
import { createBackupRun, executeBackup } from "../../backups";
import {
  createScheduleRecord,
  deleteScheduleRecord,
  updateScheduleRecord,
} from "../../backups/schedule-crud";
import { getScheduleRunTarget, resolveScheduleSources } from "../../backups/schedule-db";
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
      return presentSchedule({
        schedule: row,
        destinationNames: await scheduleDestinationNames({
          organizationId: context.activeOrganizationId,
          ids: row.destinationIds,
        }),
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
      return presentSchedule({
        schedule: row,
        destinationNames: await scheduleDestinationNames({
          organizationId: context.activeOrganizationId,
          ids: row.destinationIds,
        }),
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

      const resourceIds = await resolveScheduleSources(
        context.activeOrganizationId,
        schedule.sources,
      );
      let queued = 0;
      for (const resourceId of resourceIds) {
        for (const destinationId of schedule.destinationIds) {
          const id = await createBackupRun({
            organizationId: context.activeOrganizationId,
            resourceId,
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
