import { matchError } from "better-result";

import { orgScopedProcedure } from "../..";

import {
  autoConfigureBaseDomainViaCloudflare,
  getOrganizationSettings,
  listZonesForToken,
  saveOrganizationCloudflareConfig,
  updateOrganizationBaseDomain,
  verifyOrganizationBaseDomain,
} from "./handlers";

export const organizationRouter = {
  settings: orgScopedProcedure.organization.settings.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: input.organizationId },
      });
      const result = await getOrganizationSettings(input.organizationId);
      if (result.isErr()) throw result.error;
      return result.value;
    },
  ),

  setBaseDomain: orgScopedProcedure.organization.setBaseDomain.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: input.organizationId },
        domain: { baseDomain: input.baseDomain },
      });
      const result = await updateOrganizationBaseDomain(input);
      if (result.isErr()) throw result.error;
      return result.value;
    },
  ),

  verifyBaseDomain: orgScopedProcedure.organization.verifyBaseDomain.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: input.organizationId },
      });
      const result = await verifyOrganizationBaseDomain(input.organizationId);
      if (result.isErr()) throw result.error;
      context.log.set({
        verify: { ok: result.value.ok, reason: result.value.reason },
      });
      return result.value;
    },
  ),

  cloudflareListZones:
    orgScopedProcedure.organization.cloudflareListZones.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "organization" } });
        const result = await listZonesForToken(input.token);
        if (result.isErr()) {
          throw matchError(result.error, {
            CloudflareConfigError: (err) =>
              errors.INVALID_INPUT({ message: err.message }),
          });
        }
        return result.value;
      },
    ),

  setCloudflareConfig:
    orgScopedProcedure.organization.setCloudflareConfig.handler(
      async ({ input, context }) => {
        context.log.set({
          target: { type: "organization", id: input.organizationId },
          cloudflare: {
            zoneId: input.zoneId,
            tokenConfigured: input.token.length > 0,
          },
        });
        const result = await saveOrganizationCloudflareConfig(input);
        if (result.isErr()) throw result.error;
        return result.value;
      },
    ),

  autoConfigureBaseDomain:
    orgScopedProcedure.organization.autoConfigureBaseDomain.handler(
      async ({ input, context, errors }) => {
        context.log.set({
          target: { type: "organization", id: input.organizationId },
        });
        const result = await autoConfigureBaseDomainViaCloudflare(
          input.organizationId,
        );
        if (result.isErr()) {
          throw matchError(result.error, {
            CloudflareConfigError: (err) =>
              errors.INVALID_INPUT({ message: err.message }),
            OrganizationNotFoundError: (err) => err,
          });
        }
        context.log.set({
          autoConfigure: {
            ok: result.value.ok,
            verifyReason: result.value.verify.reason,
          },
        });
        return result.value;
      },
    ),
};
