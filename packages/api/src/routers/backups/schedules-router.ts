import type { OrganizationId } from "@otterdeploy/shared/id";

import { orgScopedProcedure, requirePermission } from "../..";
import { enforceProjectScope, enforceScheduleScope } from "../../authz/project-scope-guards";
import { createBackupRun, executeBackup } from "../../backups";
import { activeDestinationIdsFor } from "../../backups/destination-availability";
import {
  createScheduleRecord,
  deleteScheduleRecord,
  updateScheduleRecord,
} from "../../backups/schedule-crud";
import { classifyScheduleSources, getScheduleRunTarget } from "../../backups/schedule-db";
import { presentSchedule } from "./presenters";
import { listSchedules, scheduleDestinationNames } from "./service";

type ScheduleRecord = Awaited<ReturnType<typeof createScheduleRecord>>;

async function presentScheduleWithDetails(
  organizationId: OrganizationId,
  schedule: ScheduleRecord,
) {
  const [destinationNames, resolution] = await Promise.all([
    scheduleDestinationNames({ organizationId, ids: schedule.destinationIds }),
    classifyScheduleSources(organizationId, schedule.sources),
  ]);
  return presentSchedule({
    schedule,
    destinationNames,
    missingSources: resolution.missing,
  });
}

/** Resolve the requested destination ids against the org's ACTIVE ones. A
 *  shrunken result means at least one id was foreign, disabled, or deleted -
 *  `invalid` is the caller's typed INVALID_DESTINATION throw. */
async function requireActiveDestinations(
  organizationId: Parameters<typeof activeDestinationIdsFor>[0],
  requested: Parameters<typeof activeDestinationIdsFor>[1],
  invalid: () => never,
): Promise<Awaited<ReturnType<typeof activeDestinationIdsFor>>> {
  const destinationIds = await activeDestinationIdsFor(organizationId, requested);
  if (destinationIds.length !== requested.length) invalid();
  return destinationIds;
}

export const backupSchedulesRouter = {
  list: orgScopedProcedure.backups.schedules.list.handler(async ({ context }) => {
    const rows = await listSchedules({
      organizationId: context.activeOrganizationId,
    });
    return rows.map(presentSchedule);
  }),

  create: requirePermission({ backup: ["create"] }).backups.schedules.create.handler(
    async ({ input, context, errors }) => {
      enforceProjectScope(context, input.projectId);
      const destinationIds = await requireActiveDestinations(
        context.activeOrganizationId,
        input.destinationIds,
        () => {
          throw errors.INVALID_DESTINATION();
        },
      );
      const row = await createScheduleRecord({
        ...input,
        organizationId: context.activeOrganizationId,
        destinationIds,
        projectId: input.projectId ?? null,
      });
      context.log.set({ target: { type: "backup_schedule", id: row.id } });
      return presentScheduleWithDetails(context.activeOrganizationId, row);
    },
  ),

  update: requirePermission({ backup: ["update"] }).backups.schedules.update.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "backup_schedule", id: input.id } });
      await enforceScheduleScope(context, input.id);
      const destinationIds = input.destinationIds
        ? await requireActiveDestinations(
            context.activeOrganizationId,
            input.destinationIds,
            () => {
              throw errors.INVALID_DESTINATION();
            },
          )
        : undefined;
      const row = await updateScheduleRecord({
        ...input,
        organizationId: context.activeOrganizationId,
        destinationIds,
      });
      if (!row) throw errors.NOT_FOUND();
      return presentScheduleWithDetails(context.activeOrganizationId, row);
    },
  ),

  // Manual trigger: enqueue + execute a run for each of the schedule's
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

      const { resolved, missing } = await classifyScheduleSources(
        context.activeOrganizationId,
        schedule.sources,
      );
      // Orphaned schedule: nothing left to back up. Fail loudly (422 + the dead
      // refs) instead of returning a success envelope with `queued: 0`. The
      // latter reads as "ran fine" in the audit log and to the user.
      if (resolved.length === 0) {
        throw errors.NO_SOURCES({
          message:
            schedule.sources.length === 0
              ? "This schedule has no source configured"
              : "This schedule's database source no longer exists",
          data: { missing },
        });
      }
      const destinationIds = await activeDestinationIdsFor(
        context.activeOrganizationId,
        schedule.destinationIds,
      );
      let queued = 0;
      for (const { id: resourceId, kind } of resolved) {
        for (const destinationId of destinationIds) {
          const id = await createBackupRun({
            organizationId: context.activeOrganizationId,
            source: { kind, resourceId },
            destinationId,
            scheduleId: schedule.id,
            encryption: schedule.encryption === "aes-256-gcm" ? "aes-256-gcm" : "none",
            method: "manual-schedule",
          });
          queued += 1;
          // Run detached. Status + logs observable via get/logs.
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
