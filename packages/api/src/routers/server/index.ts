import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";

import { createServer, deleteServer, getServer, listServers } from "./handlers";
import { getSwarmJoinTokens } from "./join-tokens";
import { getServerStats } from "./stats";

export const serverRouter = {
  list: orgScopedProcedure.server.list.handler(async ({ context }) => {
    return listServers({ organizationId: context.activeOrganizationId });
  }),

  get: orgScopedProcedure.server.get.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "server", id: input.id } });
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

  create: requirePermission({ server: ["create"] }).server.create.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "server" } });
    const result = await createServer({
      ...input,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ServerConflictError: () => errors.CONFLICT(),
      });
    }
    context.log.set({ target: { type: "server", id: result.value.id } });
    return result.value;
  }),

  delete: requirePermission({ server: ["delete"] }).server.delete.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "server", id: input.id } });
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

  stats: orgScopedProcedure.server.stats.handler(async ({ context }) => {
    return getServerStats({ organizationId: context.activeOrganizationId });
  }),

  joinTokens: orgScopedProcedure.server.joinTokens.handler(async () => {
    return getSwarmJoinTokens();
  }),
};
