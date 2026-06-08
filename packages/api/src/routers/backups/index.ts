import { matchError } from "better-result";

import { orgScopedProcedure } from "../..";

import type { BackupRow, DestinationRow, ScheduleRow } from "./queries";
import {
  type DestinationResult,
  createDestination,
  deleteDestination,
  getBackup,
  listBackups,
  listDestinations,
  listSchedules,
  testDestination,
  updateDestination,
} from "./service";

/** Flatten an enriched backup row into the contract's `backupSchema`. */
function presentBackup(row: BackupRow) {
  return {
    ...row.backup,
    source: row.source,
    project: row.project,
    sourceService: row.sourceService,
    sourceHost: row.sourceHost,
    destinationName: row.destinationName,
    destinationType: row.destinationType,
  };
}

function presentSchedule(row: ScheduleRow) {
  return { ...row.schedule, destinationName: row.destinationName };
}

function presentDestination(row: DestinationRow) {
  return { ...row.destination, usedBytes: row.usedBytes };
}

function presentDestinationResult(row: DestinationResult) {
  return row;
}

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

  schedules: {
    list: orgScopedProcedure.backups.schedules.list.handler(
      async ({ context }) => {
        const rows = await listSchedules({
          organizationId: context.activeOrganizationId,
        });
        return rows.map(presentSchedule);
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

    create: orgScopedProcedure.backups.destinations.create.handler(
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

    update: orgScopedProcedure.backups.destinations.update.handler(
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

    delete: orgScopedProcedure.backups.destinations.delete.handler(
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
