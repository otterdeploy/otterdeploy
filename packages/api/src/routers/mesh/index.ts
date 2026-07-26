/**
 * Private networking router. Reads are `mesh: ["read"]` (the service exposure
 * UI needs to know whether a mesh exists); every mutation is `mesh:
 * ["create"|"update"|"delete"]`, which resolves to admin/owner — the stored
 * credential grants API control of the org's entire VPN.
 *
 * Design: docs/designs/vpn-mesh.md
 */

import type { MeshProviderError } from "../../mesh";

import { requirePermission } from "../..";
import {
  connectMesh,
  disconnectMesh,
  getMeshStatus,
  listMeshGroups,
  listMeshPeers,
  setMeshAccessGroupsHandler,
  verifyMesh,
} from "./handlers";

/**
 * Map a provider failure onto the contract's error set. The split matters: a
 * rejected credential and an unreachable management server need different
 * fixes, and collapsing them into one 500 makes self-hosted setups very hard
 * to debug.
 */
function throwProviderError(
  error: MeshProviderError,
  errors: {
    NOT_CONNECTED: (opts?: { message?: string }) => Error;
    PROVIDER_UNAUTHORIZED: (opts?: { message?: string }) => Error;
    PROVIDER_UNREACHABLE: (opts?: { message?: string }) => Error;
  },
): never {
  if (error.status == null && error.message.startsWith("No private network")) {
    throw errors.NOT_CONNECTED({ message: error.message });
  }
  if (error.isAuthFailure) {
    throw errors.PROVIDER_UNAUTHORIZED({ message: error.message });
  }
  throw errors.PROVIDER_UNREACHABLE({ message: error.message });
}

export const meshRouter = {
  status: requirePermission({ mesh: ["read"] }).mesh.status.handler(async ({ context }) =>
    getMeshStatus(context.activeOrganizationId),
  ),

  connect: requirePermission({ mesh: ["create"] }).mesh.connect.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "mesh" } });
      const result = await connectMesh({
        organizationId: context.activeOrganizationId,
        provider: input.provider,
        managementUrl: input.managementUrl,
        apiToken: input.apiToken,
        oauthClientId: input.oauthClientId,
        dnsLabel: input.dnsLabel,
      });
      if (result.isErr()) throwProviderError(result.error, errors);
      context.log.set({
        mesh: { provider: input.provider, selfHosted: result.value.selfHosted },
      });
      return result.value;
    },
  ),

  verify: requirePermission({ mesh: ["update"] }).mesh.verify.handler(
    async ({ context, errors }) => {
      const result = await verifyMesh(context.activeOrganizationId);
      if (result.isErr()) throwProviderError(result.error, errors);
      return result.value;
    },
  ),

  disconnect: requirePermission({ mesh: ["delete"] }).mesh.disconnect.handler(
    async ({ context }) => {
      context.log.set({ target: { type: "mesh" } });
      return disconnectMesh(context.activeOrganizationId);
    },
  ),

  listGroups: requirePermission({ mesh: ["read"] }).mesh.listGroups.handler(
    async ({ context, errors }) => {
      const result = await listMeshGroups(context.activeOrganizationId);
      if (result.isErr()) throwProviderError(result.error, errors);
      return result.value;
    },
  ),

  setAccessGroups: requirePermission({ mesh: ["update"] }).mesh.setAccessGroups.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "mesh" } });
      const result = await setMeshAccessGroupsHandler({
        organizationId: context.activeOrganizationId,
        groupIds: input.groupIds,
      });
      if (result.isErr()) throwProviderError(result.error, errors);
      return result.value;
    },
  ),

  listPeers: requirePermission({ mesh: ["read"] }).mesh.listPeers.handler(
    async ({ context, errors }) => {
      const result = await listMeshPeers(context.activeOrganizationId);
      if (result.isErr()) throwProviderError(result.error, errors);
      return result.value;
    },
  ),
};
