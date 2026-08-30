import type { BackupId, OrganizationId } from "@otterdeploy/shared/id";

import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";
import { enforceBackupScope, enforceResourceScope } from "../../authz/project-scope-guards";
import {
  type BackupRunSource,
  createBackupRun,
  executeBackup,
  getDatabaseResourceInOrg,
  listBackupLogs,
  listRestores,
  listVerifications,
  requestBackupVerification,
  restoreBackup,
  verifyBackup,
} from "../../backups";
import { activeDestinationIdsFor } from "../../backups/destination-availability";
import { listStackDatabaseResources, resolveStackDumpTarget } from "../../backups/stack";
import { inspectVolume } from "../volumes/service";
import { backupDestinationsRouter } from "./destinations-router";
import { presentBackup } from "./presenters";
import { listManagedDatabaseSources } from "./queries";
import { backupSchedulesRouter } from "./schedules-router";
import { getBackup, listBackups } from "./service";

type BackupContext = Parameters<typeof enforceBackupScope>[0] & {
  activeOrganizationId: OrganizationId;
};

async function requireBackup(context: BackupContext, id: BackupId, notFound: () => Error) {
  context.log.set({ target: { type: "backup", id } });
  await enforceBackupScope(context, id);
  const found = await getBackup({
    id,
    organizationId: context.activeOrganizationId,
  });
  if (found.isErr()) {
    throw matchError(found.error, {
      BackupNotFoundError: notFound,
    });
  }
  return found.value;
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

  /** The picker's list: managed databases AND compose-stack database
   *  services, in one shape. Deliberately NOT `terminal.targets`, which the
   *  dialog used to read — that is the terminal feature's inventory, built
   *  from `database_resource` alone, so an install whose only databases live
   *  in stacks saw "No databases found" while holding live data. */
  sources: orgScopedProcedure.backups.sources.handler(async ({ context }) => {
    const [managed, stack] = await Promise.all([
      listManagedDatabaseSources(context.activeOrganizationId),
      listStackDatabaseResources(context.activeOrganizationId),
    ]);
    return [
      ...managed.map((m) => ({ ...m, origin: "managed" as const })),
      ...stack.map((r) => ({
        resourceId: r.id,
        name: r.name,
        engine: r.engine,
        projectSlug: r.projectSlug,
        projectName: r.projectName,
        origin: "stack" as const,
      })),
    ].sort((a, b) => a.projectSlug.localeCompare(b.projectSlug) || a.name.localeCompare(b.name));
  }),

  get: orgScopedProcedure.backups.get.handler(async ({ input, context, errors }) => {
    const backup = await requireBackup(context, input.id, () => errors.NOT_FOUND());
    return presentBackup(backup);
  }),

  // Manual "backup now": RBAC: backup:run. Source is a database resource OR
  // a named Docker volume (the contract enforces exactly-one).
  run: requirePermission({ backup: ["run"] }).backups.run.handler(
    async ({ input, context, errors }) => {
      const destinationIds = await activeDestinationIdsFor(
        context.activeOrganizationId,
        input.destinationIds,
      );
      if (destinationIds.length !== input.destinationIds.length) throw errors.INVALID();

      let source: BackupRunSource;
      if (input.resourceId) {
        await enforceResourceScope(context, input.resourceId);
        const dbResource = await getDatabaseResourceInOrg({
          organizationId: context.activeOrganizationId,
          resourceId: input.resourceId,
        });
        if (dbResource) {
          source = { kind: "database", resourceId: input.resourceId };
        } else {
          // Not a MANAGED database — but a compose stack's `db` service is a
          // real database too, and on most installs it is the ONLY one. The
          // whole dump path already handles it: `resolveStackDumpTarget` reads
          // the engine off the image and the credentials out of the service's
          // resolved env, and the engine execs the child's container by
          // resource-id label exactly as it does for a managed DB. Rejecting
          // it here was the only thing standing between an operator and a
          // backup of the data they actually have.
          const stackTarget = await resolveStackDumpTarget(input.resourceId);
          if (!stackTarget) throw errors.INVALID();
          source = { kind: "stack", resourceId: input.resourceId };
        }
      } else if (input.volumeName) {
        // Volumes are daemon objects with no org column; existence is the
        // gate here, matching the (host-scoped) volumes surface.
        const found = await inspectVolume(input.volumeName);
        if (!found.ok) throw errors.INVALID();
        source = { kind: "volume", volumeName: input.volumeName };
      } else {
        throw errors.INVALID();
      }

      // One backup record per destination; the dump runs once per record.
      const ids: Awaited<ReturnType<typeof createBackupRun>>[] = [];
      for (const destinationId of destinationIds) {
        const id = await createBackupRun({
          organizationId: context.activeOrganizationId,
          source,
          destinationId,
          encryption: input.encryption,
          method: "manual",
          approach: input.approach,
        });
        ids.push(id);
        // Run detached. Status + logs are observable via get/logs.
        void executeBackup(id);
      }
      context.log.set({ target: { type: "backup", id: ids[0] } });
      return { ids, status: "queued" };
    },
  ),

  // Integrity check for a stored archive. Read-only, org-scoped.
  verify: orgScopedProcedure.backups.verify.handler(async ({ input, context, errors }) => {
    await requireBackup(context, input.id, () => errors.NOT_FOUND());
    return verifyBackup(input.id);
  }),

  // Restore-proving verification (sandbox restore), detached: RBAC: backup:run
  // (it exercises the same engine surface as a run, not a restore of live data).
  verifyRestore: requirePermission({ backup: ["run"] }).backups.verifyRestore.handler(
    async ({ input, context, errors }) => {
      await requireBackup(context, input.id, () => errors.NOT_FOUND());
      const requested = await requestBackupVerification(input.id, "manual");
      if (requested.isErr()) {
        throw matchError(requested.error, {
          BackupContextMissingError: () => errors.NOT_FOUND(),
          VerificationUnsupportedError: (e) => errors.UNSUPPORTED({ data: { reason: e.message } }),
        });
      }
      return { verificationId: requested.value, status: "queued" };
    },
  ),

  // Verification history for a run, newest first. Read-only, org-scoped.
  verifications: orgScopedProcedure.backups.verifications.handler(
    async ({ input, context, errors }) => {
      await requireBackup(context, input.id, () => errors.NOT_FOUND());
      return listVerifications(input.id);
    },
  ),

  // Restore history for a run, newest first. Read-only, org-scoped.
  restores: orgScopedProcedure.backups.restores.handler(async ({ input, context, errors }) => {
    await requireBackup(context, input.id, () => errors.NOT_FOUND());
    return listRestores(input.id);
  }),

  // Restore a succeeded backup: RBAC: backup:restore.
  restore: requirePermission({ backup: ["restore"] }).backups.restore.handler(
    async ({ input, context, errors }) => {
      await requireBackup(context, input.id, () => errors.NOT_FOUND());
      const result = await restoreBackup({
        backupId: input.id,
        mode: input.mode,
        confirm: input.confirm,
        // Cross-database restore. The target is re-resolved (and its engine
        // re-checked) server-side; enforceBackupScope above has already tied
        // the SNAPSHOT to this org.
        targetResourceId: input.targetResourceId,
      });
      return {
        ok: result.ok,
        mode: input.mode,
        data: result.bytes ? result.bytes.toString("base64") : null,
        filename: result.bytes ? (result.filename ?? `${input.id}.dump`) : null,
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
