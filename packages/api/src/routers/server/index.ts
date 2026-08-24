import { ORPCError } from "@orpc/server";
import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";
import { queryServerMetrics } from "../../metrics/server-query";
import { setServerAvailability } from "./availability";
import { serverEnrollmentRouter } from "./enrollment-router";
import {
  createServer,
  deleteServer,
  getServer,
  listServers,
  provisionServer,
  reapplyFirewall,
  retryProvision,
} from "./handlers";
import { getServerHealth } from "./health";
import { streamProvisionLogs } from "./provision-stream";
import { getServerInOrg } from "./queries";
import { removeServerNode } from "./remove-node";
import { setServerRole } from "./role";
import { getServerStats } from "./stats";
import { listSwarmNodes } from "./swarm-nodes";
import { getServerUnits } from "./units";

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
          // Surfaces the real Postgres message instead of the opaque
          // Panic("catch handler threw") that replaced it before.
          ServerDatabaseError: (e: { message: string }) =>
            new ORPCError("INTERNAL_SERVER_ERROR", { message: e.message }),
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

  // Per-node history. `health` is the latest snapshot (one upserted row per
  // server); this is the append-only series behind it. An id the org does not
  // own yields an empty series rather than an error: the join is the auth
  // boundary and an empty chart leaks nothing.
  metrics: orgScopedProcedure.server.metrics.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "server", id: input.id } });
    const since = new Date(Date.now() - input.windowMinutes * 60 * 1000);
    const points = await queryServerMetrics({
      organizationId: context.activeOrganizationId,
      serverId: input.id,
      since,
    });
    return { points };
  }),

  // Latest state per unit on this node. Deliberately not a series: units are a
  // status surface, and a row per unit per tick would be unbounded. Same
  // org-scoping rule as `metrics` above.
  units: orgScopedProcedure.server.units.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "server", id: input.id } });
    return getServerUnits({
      organizationId: context.activeOrganizationId,
      serverId: input.id,
    });
  }),

  ...serverEnrollmentRouter,

  provision: requirePermission({ server: ["create"] }).server.provision.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "server" } });
      const result = await provisionServer({
        ...input,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ServerConflictError: () => errors.CONFLICT(),
          // Surfaces the real Postgres message instead of the opaque
          // Panic("catch handler threw") that replaced it before.
          ServerDatabaseError: (e: { message: string }) =>
            new ORPCError("INTERNAL_SERVER_ERROR", { message: e.message }),
          ProvisionCredentialError: () => errors.BAD_REQUEST(),
        });
      }
      context.log.set({ target: { type: "server", id: result.value.id } });
      return result.value;
    },
  ),

  // Live provisioning output. Auth boundary: the org must own the server row;
  // an unmatched id yields an empty stream (no info leak), same posture as the
  // deployment log tail.
  provisionLogs: orgScopedProcedure.server.provisionLogs.handler(async function* ({
    input,
    context,
  }) {
    context.log.set({ target: { type: "server", id: input.id } });
    const owned = await getServerInOrg({
      serverId: input.id,
      organizationId: context.activeOrganizationId,
    });
    if (!owned) return;
    yield* streamProvisionLogs(input.id);
  }),

  retryProvision: requirePermission({ server: ["create"] }).server.retryProvision.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "server", id: input.id } });
      const result = await retryProvision({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ServerNotFoundError: () => errors.NOT_FOUND(),
          ProvisionNotFailedError: () => errors.NOT_FAILED(),
          ProvisionMissingCredentialError: () => errors.MISSING_CREDENTIAL(),
        });
      }
      return result.value;
    },
  ),

  reapplyFirewall: requirePermission({ server: ["create"] }).server.reapplyFirewall.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "server", id: input.id } });
      const result = await reapplyFirewall({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ServerNotFoundError: () => errors.NOT_FOUND(),
          ProvisionMissingCredentialError: () => errors.MISSING_CREDENTIAL(),
        });
      }
      return result.value;
    },
  ),
};
