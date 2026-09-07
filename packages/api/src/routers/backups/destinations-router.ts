import type { BackupDestinationId, OrganizationId } from "@otterdeploy/shared/id";

import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";
import { presentDestination, presentDestinationResult } from "./presenters";
import {
  createDestination,
  deleteDestination,
  listDestinations,
  setDestinationEnabled,
  setDestinationUsedForBackups,
  testDestination,
  updateDestination,
} from "./service";

/**
 * The two flag flips (`setEnabled`, `setUsedForBackups`) answer identically:
 * same two failures, same presented row. Stated once so the handlers show
 * only what differs — which flag, and to what.
 */
async function presentFlagFlip(
  pending: Promise<Awaited<ReturnType<typeof setDestinationEnabled>>>,
  errors: { NOT_FOUND: () => Error; LAST_ACTIVE: () => Error },
) {
  const result = await pending;
  if (result.isErr()) {
    throw matchError(result.error, {
      DestinationNotFoundError: () => errors.NOT_FOUND(),
      DestinationLastActiveError: () => errors.LAST_ACTIVE(),
    });
  }
  return presentDestinationResult(result.value);
}

/** Tag the log line with the destination and hand back the org id, so the
 *  call it wraps stays a single expression. */
function logDestination(
  context: {
    activeOrganizationId: OrganizationId;
    log: { set: (fields: Record<string, unknown>) => void };
  },
  id: BackupDestinationId,
): OrganizationId {
  context.log.set({ target: { type: "backup_destination", id } });
  return context.activeOrganizationId;
}

export const backupDestinationsRouter = {
  list: orgScopedProcedure.backups.destinations.list.handler(async ({ context }) => {
    const rows = await listDestinations({
      organizationId: context.activeOrganizationId,
    });
    return rows.map(presentDestination);
  }),

  create: requirePermission({ backup: ["create"] }).backups.destinations.create.handler(
    async ({ input, context, errors }) => {
      const result = await createDestination({
        organizationId: context.activeOrganizationId,
        name: input.name,
        type: input.type,
        config: input.config,
        secret: input.secret,
        usedForBackups: input.usedForBackups,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          DestinationConfigInvalidError: (err) =>
            errors.INVALID_CONFIG({ data: { reason: err.reason } }),
        });
      }
      context.log.set({
        target: { type: "backup_destination", id: result.value.id },
      });
      return presentDestinationResult(result.value);
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
          DestinationConfigInvalidError: (err) =>
            errors.INVALID_CONFIG({ data: { reason: err.reason } }),
          DestinationManagedError: (err) => errors.MANAGED({ data: { operation: err.operation } }),
        });
      }
      return presentDestinationResult(result.value);
    },
  ),

  setEnabled: requirePermission({ backup: ["update"] }).backups.destinations.setEnabled.handler(
    async ({ input, context, errors }) =>
      presentFlagFlip(
        setDestinationEnabled({
          organizationId: logDestination(context, input.id),
          id: input.id,
          enabled: input.enabled,
        }),
        errors,
      ),
  ),

  setUsedForBackups: requirePermission({
    backup: ["update"],
  }).backups.destinations.setUsedForBackups.handler(async ({ input, context, errors }) =>
    presentFlagFlip(
      setDestinationUsedForBackups({
        organizationId: logDestination(context, input.id),
        id: input.id,
        usedForBackups: input.usedForBackups,
      }),
      errors,
    ),
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
          DestinationInUseError: (err) => errors.CONFLICT({ data: { references: err.references } }),
          DestinationManagedError: (err) => errors.MANAGED({ data: { operation: err.operation } }),
        });
      }
      return result.value;
    },
  ),

  test: orgScopedProcedure.backups.destinations.test.handler(async ({ input, context, errors }) => {
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
        DestinationTestFailedError: (err) => errors.TEST_FAILED({ data: { reason: err.reason } }),
      });
    }
    return result.value;
  }),
};
