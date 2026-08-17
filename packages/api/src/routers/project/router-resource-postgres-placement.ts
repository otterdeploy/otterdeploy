/**
 * The database placement handler, split out of router-resource-postgres so that
 * router file stays under its line cap. Behaviour lives in
 * ./database-placement: this is only the transport binding.
 */

import { matchError } from "better-result";

import { requirePermission } from "../../index";
import { setDatabasePlacement } from "./database-placement";

export const postgresSetPlacementHandler = requirePermission({
  database: ["update"],
}).project.resource.database.postgres.setPlacement.handler(async ({ input, context, errors }) => {
  context.log.set({
    target: {
      type: "resource",
      kind: "postgres",
      id: input.resourceId,
      projectId: input.projectId,
    },
  });
  const result = await setDatabasePlacement(
    {
      projectId: input.projectId,
      resourceId: input.resourceId,
      organizationId: context.activeOrganizationId,
      serverId: input.serverId,
      acknowledgeDataLoss: input.acknowledgeDataLoss,
    },
    context.log,
  );
  if (result.isErr()) {
    throw matchError(result.error, {
      ProjectNotFoundError: () => errors.NOT_FOUND(),
      DatabaseResourceNotFoundError: () => errors.NOT_FOUND(),
      DatabaseMoveDataLossError: (e) => errors.DATABASE_MOVE_DATA_LOSS({ message: e.message }),
    });
  }
  return result.value;
});
