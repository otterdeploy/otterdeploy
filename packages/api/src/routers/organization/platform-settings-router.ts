/**
 * Platform-wide settings endpoints (control-plane domain + email transport),
 * split from the org router index for size. They mutate the platform_settings
 * singleton but are surfaced under org settings for the single-tenant beta.
 * Same procedure gating as the rest of the org settings: reads open to any
 * member, writes require `organization:update` (owner/admin).
 */

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { matchError } from "better-result";
import { eq } from "drizzle-orm";

import { orgScopedProcedure, requirePermission } from "../..";
import { getGlobalCaddyOptions, saveGlobalCaddyOptions } from "../project/proxy-routes";
import {
  autoConfigureControlPlaneDomain,
  getControlPlaneDomain,
  setControlPlaneDomain,
  verifyControlPlaneDomain,
} from "./control-plane-domain";
import { getEmailSettings, saveEmailSettings, sendTestEmail } from "./handlers";

const orgUpdateProcedure = requirePermission({ organization: ["update"] });

/** serverIp view for the Instance page. envOverride tells the UI the value
 *  is pinned by env SERVER_IP (re-applied every boot) so edits won't stick. */
async function serverIpView(): Promise<{ serverIp: string | null; envOverride: boolean }> {
  const [row] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return { serverIp: row?.serverIp ?? null, envOverride: Boolean(env.SERVER_IP) };
}

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

  // ─── Instance network + edge defaults ─────────────────────────────
  getServerIp: orgScopedProcedure.organization.getServerIp.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "organization", id: input.organizationId } });
    return serverIpView();
  }),

  setServerIp: orgUpdateProcedure.organization.setServerIp.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: input.organizationId },
        instance: { serverIp: input.serverIp || null },
      });
      const value = input.serverIp.trim() || null;
      await db
        .insert(platformSettings)
        .values({ id: PLATFORM_SETTINGS_ID, serverIp: value })
        .onConflictDoUpdate({ target: platformSettings.id, set: { serverIp: value } });
      return serverIpView();
    },
  ),

  getEdgeOptions: orgScopedProcedure.organization.getEdgeOptions.handler(
    async ({ input, context }) => {
      context.log.set({ target: { type: "organization", id: input.organizationId } });
      return getGlobalCaddyOptions();
    },
  ),

  setEdgeOptions: orgUpdateProcedure.organization.setEdgeOptions.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: input.organizationId },
        edge: { httpsAutoRedirect: input.httpsAutoRedirect },
      });
      // saveGlobalCaddyOptions persists + reconciles the live edge; validated
      // options can't produce invalid global syntax (same guarantee the
      // project-Networking editor relies on).
      return saveGlobalCaddyOptions(
        { acmeEmail: input.acmeEmail, httpsAutoRedirect: input.httpsAutoRedirect },
        context.log,
      );
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
