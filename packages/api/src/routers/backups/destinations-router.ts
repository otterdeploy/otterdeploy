import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";
import { presentDestination, presentDestinationResult } from "./presenters";
import {
  createDestination,
  deleteDestination,
  listDestinations,
  testDestination,
  updateDestination,
} from "./service";

export const backupDestinationsRouter = {
  list: orgScopedProcedure.backups.destinations.list.handler(async ({ context }) => {
    const rows = await listDestinations({
      organizationId: context.activeOrganizationId,
    });
    return rows.map(presentDestination);
  }),

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
          DestinationInUseError: (err) => errors.CONFLICT({ data: { references: err.references } }),
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
