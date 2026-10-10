/**
 * Read-only base-domain views for Settings → Domains, split from the org
 * router index for size. Each derives the org from the caller's active
 * organization, never from input (see ./index).
 */

import { orgScopedProcedure } from "../..";
import { authorizeCapability } from "../../authz/capability";
import {
  checkOrganizationBaseDomainDns,
  getOrganizationCloudflareZone,
  listOrganizationBaseDomainHostnames,
} from "./base-domain";

export const baseDomainRouter = {
  checkBaseDomainDns: orgScopedProcedure.organization.checkBaseDomainDns.handler(
    async ({ context }) => {
      context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });
      // The server IP is for installation admins only (the same rule that
      // gates organization.getServerIp). Everyone else gets the states.
      const admin = await authorizeCapability(context.actor, { scope: "install", mode: "read" });
      const result = await checkOrganizationBaseDomainDns(context.activeOrganizationId, {
        revealServerIp: admin.allowed,
      });
      if (result.isErr()) throw result.error;
      context.log.set({
        baseDomainDns: {
          wildcard: result.value.wildcard?.state ?? null,
          txt: result.value.txt?.state ?? null,
        },
      });
      return result.value;
    },
  ),

  baseDomainHostnames: orgScopedProcedure.organization.baseDomainHostnames.handler(
    async ({ context }) => {
      context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });
      const result = await listOrganizationBaseDomainHostnames(context.activeOrganizationId);
      if (result.isErr()) throw result.error;
      return result.value;
    },
  ),

  cloudflareZone: orgScopedProcedure.organization.cloudflareZone.handler(async ({ context }) => {
    context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });
    const result = await getOrganizationCloudflareZone(context.activeOrganizationId);
    if (result.isErr()) throw result.error;
    context.log.set({ cloudflare: { token: result.value.token } });
    return result.value;
  }),
};
