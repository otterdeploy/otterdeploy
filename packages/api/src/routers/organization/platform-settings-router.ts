/**
 * Platform-wide settings endpoints (control-plane domain + email transport),
 * split from the org router index for size. They mutate the platform_settings
 * singleton but are surfaced under org settings for the single-tenant beta.
 * Same procedure gating as the rest of the org settings: reads open to any
 * member, writes require `organization:update` (owner/admin).
 */

import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";
import {
  autoConfigureControlPlaneDomain,
  getControlPlaneDomain,
  setControlPlaneDomain,
  verifyControlPlaneDomain,
} from "./control-plane-domain";
import { getEmailSettings, saveEmailSettings, sendTestEmail } from "./handlers";

const orgUpdateProcedure = requirePermission({ organization: ["update"] });

export const platformSettingsRouter = {
  controlPlaneDomain: orgScopedProcedure.organization.controlPlaneDomain.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: input.organizationId },
      });
      return getControlPlaneDomain();
    },
  ),

  setControlPlaneDomain: orgUpdateProcedure.organization.setControlPlaneDomain.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: input.organizationId },
        domain: { controlPlaneDomain: input.domain },
      });
      return setControlPlaneDomain(input.domain, context.log);
    },
  ),

  verifyControlPlaneDomain: orgUpdateProcedure.organization.verifyControlPlaneDomain.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: input.organizationId },
      });
      const result = await verifyControlPlaneDomain(context.log);
      context.log.set({ verify: { ok: result.ok, reason: result.reason } });
      return result;
    },
  ),

  autoConfigureControlPlaneDomain:
    orgUpdateProcedure.organization.autoConfigureControlPlaneDomain.handler(
      async ({ input, context, errors }) => {
        context.log.set({
          target: { type: "organization", id: input.organizationId },
        });
        const result = await autoConfigureControlPlaneDomain(input.organizationId, context.log);
        if (result.isErr()) {
          throw matchError(result.error, {
            ControlPlaneDomainError: (err) => errors.INVALID_INPUT({ message: err.message }),
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

  // ─── Outbound email transport ──────────────────────────────────────
  getEmailSettings: orgScopedProcedure.organization.getEmailSettings.handler(async () =>
    getEmailSettings(),
  ),

  setEmailSettings: orgUpdateProcedure.organization.setEmailSettings.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: input.organizationId },
      });
      return saveEmailSettings({
        provider: input.provider,
        from: input.from,
        resendApiKey: input.resendApiKey,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpSecure: input.smtpSecure,
        smtpUser: input.smtpUser,
        smtpPassword: input.smtpPassword,
      });
    },
  ),

  testEmail: orgUpdateProcedure.organization.testEmail.handler(async ({ input }) =>
    sendTestEmail(input.to),
  ),
};
