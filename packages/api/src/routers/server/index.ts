import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";
import { setServerAvailability } from "./availability";
import { createServer, deleteServer, getServer, listServers } from "./handlers";
import { getServerHealth } from "./health";
import { getSwarmJoinTokens } from "./join-tokens";
import { removeServerNode } from "./remove-node";
import { setServerRole } from "./role";
import { getServerStats } from "./stats";
import { listSwarmNodes } from "./swarm-nodes";

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

  create: requirePermission({ server: ["create"] }).server.create.handler(
    async ({ input, context, errors }) => {
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
    },
  ),

  delete: requirePermission({ server: ["delete"] }).server.delete.handler(
    async ({ input, context, errors }) => {
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
    },
  ),

  setAvailability: requirePermission({ server: ["update"] }).server.setAvailability.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "server", id: input.id } });
      const result = await setServerAvailability(
        {
          id: input.id,
          availability: input.availability,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ServerNotFoundError: () => errors.NOT_FOUND(),
          SwarmUnavailableError: () => errors.SWARM_UNAVAILABLE(),
          SwarmNodeNotFoundError: () => errors.NODE_NOT_FOUND(),
          SwarmNodeUpdateError: () => errors.UPDATE_FAILED(),
        });
      }
      return result.value;
    },
  ),

  setRole: requirePermission({ server: ["update"] }).server.setRole.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "server", id: input.id } });
      const result = await setServerRole(
        {
          id: input.id,
          role: input.role,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ServerNotFoundError: () => errors.NOT_FOUND(),
          SwarmUnavailableError: () => errors.SWARM_UNAVAILABLE(),
          SwarmNodeNotFoundError: () => errors.NODE_NOT_FOUND(),
          SwarmLastManagerError: () => errors.LAST_MANAGER(),
          SwarmLeaderDemoteError: () => errors.LEADER(),
          SwarmNodeUpdateError: () => errors.UPDATE_FAILED(),
        });
      }
      return result.value;
    },
  ),

  removeNode: requirePermission({ server: ["delete"] }).server.removeNode.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "server", id: input.id } });
      const result = await removeServerNode(
        {
          id: input.id,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ServerNotFoundError: () => errors.NOT_FOUND(),
          SwarmUnavailableError: () => errors.SWARM_UNAVAILABLE(),
          SwarmNodeNotFoundError: () => errors.NODE_NOT_FOUND(),
          SwarmNodeNotDownError: () => errors.NODE_NOT_DOWN(),
          SwarmNodeRemoveError: () => errors.REMOVE_FAILED(),
        });
      }
      return result.value;
    },
  ),

  swarmNodes: orgScopedProcedure.server.swarmNodes.handler(async ({ context, errors }) => {
    const result = await listSwarmNodes({ organizationId: context.activeOrganizationId });
    if (result.isErr()) {
      throw matchError(result.error, {
        SwarmNodeListError: () => errors.LIST_FAILED(),
      });
    }
    return result.value;
  }),

  stats: orgScopedProcedure.server.stats.handler(async ({ context }) => {
    return getServerStats({ organizationId: context.activeOrganizationId });
  }),

  health: orgScopedProcedure.server.health.handler(async ({ context }) => {
    return getServerHealth({ organizationId: context.activeOrganizationId });
  }),

  joinTokens: orgScopedProcedure.server.joinTokens.handler(async () => {
    return getSwarmJoinTokens();
  }),
};
