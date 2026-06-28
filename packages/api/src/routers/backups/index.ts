import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";
import { enforceBackupScope, enforceResourceScope } from "../../authz/project-scope-guards";
import {
  createBackupRun,
  executeBackup,
  getDatabaseResourceInOrg,
  listBackupLogs,
  restoreBackup,
} from "../../backups";
import { backupDestinationsRouter } from "./destinations-router";
import { presentBackup } from "./presenters";
import { backupSchedulesRouter } from "./schedules-router";
import { getBackup, listBackups } from "./service";

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

  get: orgScopedProcedure.backups.get.handler(async ({ input, context, errors }) => {
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
  }),

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

  logs: orgScopedProcedure.backups.logs.handler(async ({ input, context }) => {
    await enforceBackupScope(context, input.id);
    // Scope check: a backup in another org (or none) yields an empty stream.
    const found = await getBackup({
      id: input.id,
      organizationId: context.activeOrganizationId,
    });
    if (found.isErr()) return [];
    return listBackupLogs(input.id, input.afterSeq);
  }),

  schedules: backupSchedulesRouter,

  destinations: backupDestinationsRouter,
};
