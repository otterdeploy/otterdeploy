import { matchError } from "better-result";

import { orgScopedProcedure } from "../..";

import { createServer, deleteServer, getServer, listServers } from "./handlers";

export const serverRouter = {
  list: orgScopedProcedure.server.list.handler(async ({ context }) => {
    return listServers({ organizationId: context.activeOrganizationId });
  }),

  get: orgScopedProcedure.server.get.handler(async ({ input, context, errors }) => {
    const result = await getServer({
      id: input.id,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ServerNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  create: orgScopedProcedure.server.create.handler(async ({ input, context, errors }) => {
    const result = await createServer({
      ...input,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ServerConflictError: () => errors.CONFLICT(),
      });
    }
    return result.value;
  }),

  delete: orgScopedProcedure.server.delete.handler(async ({ input, context, errors }) => {
    const result = await deleteServer({
      id: input.id,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ServerNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),
};
