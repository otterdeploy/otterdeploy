import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";
import {
  enforceBackupScope,
  enforceProjectScope,
  enforceResourceScope,
  enforceScheduleScope,
} from "../../authz/project-scope-guards";
import {
  createBackupRun,
  executeBackup,
  getDatabaseResourceInOrg,
  listBackupLogs,
  restoreBackup,
} from "../../backups";
import {
  getScheduleRunTarget,
  resolveScheduleSources,
} from "../../backups/schedule-db";
import {
  createScheduleRecord,
  deleteScheduleRecord,
  updateScheduleRecord,
} from "../../backups/schedule-crud";

import {
  createDestination,
  deleteDestination,
  getBackup,
  listBackups,
  listDestinations,
  listSchedules,
  scheduleDestinationNames,
  testDestination,
  updateDestination,
} from "./service";
import {
  presentBackup,
  presentDestination,
  presentDestinationResult,
  presentSchedule,
} from "./presenters";

export const backupsRouter = {
  list: orgScopedProcedure.backups.list.handler(async ({ input, context }) => {
    const rows = await listBackups({
      organizationId: context.activeOrganizationId,
      projectId: input?.projectId,
      kind: input?.kind,
      destinationId: input?.destinationId,
      search: input?.search,
    });
    return rows.map(presentBackup);
  }),

  get: orgScopedProcedure.backups.get.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "backup", id: input.id } });
      const result = await getBackup({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          BackupNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return presentBackup(result.value);
    },
  ),

  // Manual "backup now" — RBAC: backup:run.
  run: requirePermission({ backup: ["run"] }).backups.run.handler(
    async ({ input, context, errors }) => {
      await enforceResourceScope(context, input.resourceId);
      const dbResource = await getDatabaseResourceInOrg({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!dbResource) throw errors.INVALID();

      // One backup record per destination; the dump runs once per record.
      const ids: Awaited<ReturnType<typeof createBackupRun>>[] = [];
      for (const destinationId of input.destinationIds) {
        const id = await createBackupRun({
          organizationId: context.activeOrganizationId,
          resourceId: input.resourceId,
          destinationId,
          encryption: input.encryption,
          method: "manual",
        });
        ids.push(id);
        // Run detached — status + logs are observable via get/logs.
        void executeBackup(id);
      }
      context.log.set({ target: { type: "backup", id: ids[0] } });
      return { ids, status: "queued" };
    },
  ),

  // Restore a succeeded backup — RBAC: backup:restore.
  restore: requirePermission({ backup: ["restore"] }).backups.restore.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "backup", id: input.id } });
      await enforceBackupScope(context, input.id);
      // Scope check: the backup must belong to the caller's org.
      const found = await getBackup({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (found.isErr()) {
        throw matchError(found.error, {
          BackupNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      const result = await restoreBackup({
        backupId: input.id,
        mode: input.mode,
        confirm: input.confirm,
      });
      return {
        ok: result.ok,
        mode: input.mode,
        data: result.bytes ? result.bytes.toString("base64") : null,
        filename: result.bytes ? `${input.id}.dump` : null,
      };
    },
  ),

  logs: orgScopedProcedure.backups.logs.handler(
    async ({ input, context }) => {
      await enforceBackupScope(context, input.id);
      // Scope check: a backup in another org (or none) yields an empty stream.
      const found = await getBackup({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (found.isErr()) return [];
      return listBackupLogs(input.id, input.afterSeq);
    },
  ),

  schedules: {
    list: orgScopedProcedure.backups.schedules.list.handler(
      async ({ context }) => {
        const rows = await listSchedules({
          organizationId: context.activeOrganizationId,
        });
        return rows.map(presentSchedule);
      },
    ),

    create: requirePermission({ backup: ["create"] }).backups.schedules.create.handler(
      async ({ input, context }) => {
        await enforceProjectScope(context, input.projectId);
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
              encryption:
                schedule.encryption === "aes-256-gcm" ? "aes-256-gcm" : "none",
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
  },

  destinations: {
    list: orgScopedProcedure.backups.destinations.list.handler(
      async ({ context }) => {
        const rows = await listDestinations({
          organizationId: context.activeOrganizationId,
        });
        return rows.map(presentDestination);
      },
    ),

    create: requirePermission({ backup: ["create"] }).backups.destinations.create.handler(
      async ({ input, context }) => {
        const row = await createDestination({
          organizationId: context.activeOrganizationId,
          name: input.name,
          type: input.type,
          config: input.config,
          secret: input.secret,
        });
        context.log.set({
          target: { type: "backup_destination", id: row.id },
        });
        return presentDestinationResult(row);
      },
    ),

    update: requirePermission({ backup: ["update"] }).backups.destinations.update.handler(
      async ({ input, context, errors }) => {
        context.log.set({
          target: { type: "backup_destination", id: input.id },
        });
        const result = await updateDestination({
          organizationId: context.activeOrganizationId,
          id: input.id,
          name: input.name,
          config: input.config,
          secret: input.secret,
        });
        if (result.isErr()) {
          throw matchError(result.error, {
            DestinationNotFoundError: () => errors.NOT_FOUND(),
          });
        }
        return presentDestinationResult(result.value);
      },
    ),

    delete: requirePermission({ backup: ["delete"] }).backups.destinations.delete.handler(
      async ({ input, context, errors }) => {
        context.log.set({
          target: { type: "backup_destination", id: input.id },
        });
        const result = await deleteDestination({
          organizationId: context.activeOrganizationId,
          id: input.id,
        });
        if (result.isErr()) {
          throw matchError(result.error, {
            DestinationNotFoundError: () => errors.NOT_FOUND(),
            DestinationInUseError: (err) =>
              errors.CONFLICT({ data: { references: err.references } }),
          });
        }
        return result.value;
      },
    ),

    test: orgScopedProcedure.backups.destinations.test.handler(
      async ({ input, context, errors }) => {
        context.log.set({
          target: { type: "backup_destination", id: input.id },
        });
        const result = await testDestination({
          organizationId: context.activeOrganizationId,
          id: input.id,
        });
        if (result.isErr()) {
          throw matchError(result.error, {
            DestinationNotFoundError: () => errors.NOT_FOUND(),
            DestinationTestFailedError: (err) =>
              errors.TEST_FAILED({ data: { reason: err.reason } }),
          });
        }
        return result.value;
      },
    ),
  },
};
