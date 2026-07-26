/**
 * Platform-wide settings endpoints (control-plane domain + email transport),
 * split from the org router index for size. They mutate the platform_settings
 * singleton but are surfaced under org settings. Every endpoint requires the
 * server-owned installation administrator identity; organization roles do not
 * grant authority over singleton settings.
 */

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { matchError } from "better-result";
import { log } from "evlog";
import { eq } from "drizzle-orm";

import { requireInstallAdmin } from "../..";
import { reconcile } from "../../caddy";
import { getGlobalCaddyOptions, saveGlobalCaddyOptions } from "../project/proxy-routes";
import {
  autoConfigureControlPlaneDomain,
  getControlPlaneDomain,
  setControlPlaneDomain,
  verifyControlPlaneDomain,
} from "./control-plane-domain";
import { getEmailSettings, saveEmailSettings, sendTestEmail } from "./handlers";
import {
  getAccessSettings,
  getCrowdsecSettings,
  getMessagingSettings,
  getRuntimeSettings,
  saveAccessSettings,
  saveCrowdsecSettings,
  saveMessagingSettings,
  saveRuntimeSettings,
} from "./runtime-settings";
import { listSocialProviders, saveSocialProvider } from "./social-providers";

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
  controlPlaneDomain: requireInstallAdmin().organization.controlPlaneDomain.handler(
    async ({ context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
      });
      return getControlPlaneDomain();
    },
  ),

  setControlPlaneDomain: requireInstallAdmin().organization.setControlPlaneDomain.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
        domain: { controlPlaneDomain: input.domain },
      });
      return setControlPlaneDomain(input.domain, context.log);
    },
  ),

  verifyControlPlaneDomain: requireInstallAdmin().organization.verifyControlPlaneDomain.handler(
    async ({ context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
      });
      const result = await verifyControlPlaneDomain(context.log);
      context.log.set({ verify: { ok: result.ok, reason: result.reason } });
      return result;
    },
  ),

  autoConfigureControlPlaneDomain:
    requireInstallAdmin().organization.autoConfigureControlPlaneDomain.handler(
      async ({ context, errors }) => {
        context.log.set({
          target: { type: "organization", id: context.activeOrganizationId },
        });
        // Sources the operator's OWN org's stored Cloudflare token/zone — never
        // a caller-supplied organizationId (od-5j8.8: install-admin status
        // shouldn't imply "pull any org's Cloudflare credentials on request").
        const result = await autoConfigureControlPlaneDomain(
          context.activeOrganizationId,
          context.log,
        );
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
  getServerIp: requireInstallAdmin().organization.getServerIp.handler(async ({ context }) => {
    context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });
    return serverIpView();
  }),

  setServerIp: requireInstallAdmin().organization.setServerIp.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
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

  getEdgeOptions: requireInstallAdmin().organization.getEdgeOptions.handler(async ({ context }) => {
    context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });
    return getGlobalCaddyOptions();
  }),

  setEdgeOptions: requireInstallAdmin().organization.setEdgeOptions.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
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
  getEmailSettings: requireInstallAdmin().organization.getEmailSettings.handler(async () =>
    getEmailSettings(),
  ),

  setEmailSettings: requireInstallAdmin().organization.setEmailSettings.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
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

  testEmail: requireInstallAdmin().organization.testEmail.handler(async ({ input }) =>
    sendTestEmail(input.to),
  ),

  // ─── Runtime configuration (od-gfg) ────────────────────────────────
  // Formerly env-only settings that are runtime policy rather than boot-time
  // infrastructure. Install-admin only, like everything else on this router:
  // these are install-wide, so an organization role must not confer authority
  // over them.
  getAccessSettings: requireInstallAdmin().organization.getAccessSettings.handler(async () =>
    getAccessSettings(),
  ),

  setAccessSettings: requireInstallAdmin().organization.setAccessSettings.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
        access: { registrationMode: input.registrationMode },
      });
      return saveAccessSettings(input.registrationMode);
    },
  ),

  listSocialProviders: requireInstallAdmin().organization.listSocialProviders.handler(async () =>
    listSocialProviders(),
  ),

  setSocialProvider: requireInstallAdmin().organization.setSocialProvider.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
        // Credentials never reach the log — only which provider moved and how.
        sso: { provider: input.id, enabled: input.enabled },
      });
      return saveSocialProvider({
        id: input.id,
        enabled: input.enabled,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        issuer: input.issuer,
      });
    },
  ),

  getMessagingSettings: requireInstallAdmin().organization.getMessagingSettings.handler(async () =>
    getMessagingSettings(),
  ),

  setMessagingSettings: requireInstallAdmin().organization.setMessagingSettings.handler(
    async ({ input, context }) => {
      context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });
      return saveMessagingSettings({
        twilioAccountSid: input.twilioAccountSid,
        twilioFromNumber: input.twilioFromNumber,
        twilioAuthToken: input.twilioAuthToken,
        fcmServerKey: input.fcmServerKey,
      });
    },
  ),

  getCrowdsecSettings: requireInstallAdmin().organization.getCrowdsecSettings.handler(async () =>
    getCrowdsecSettings(),
  ),

  setCrowdsecSettings: requireInstallAdmin().organization.setCrowdsecSettings.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
        firewall: { crowdsecEnabled: input.enabled },
      });
      const saved = await saveCrowdsecSettings({
        enabled: input.enabled,
        lapiUrl: input.lapiUrl,
        bouncerKey: input.bouncerKey,
      });
      // Re-render the edge so the `crowdsec` app + per-site gate appear or
      // disappear now, rather than at whatever unrelated change reconciles
      // next. Best-effort: the setting is already persisted, and a failed
      // reconcile must not read as a failed save.
      await reconcile(context.log).catch((cause) =>
        log.warn({
          firewall: { event: "reconcile-after-crowdsec-save-failed" },
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
      return saved;
    },
  ),

  getRuntimeSettings: requireInstallAdmin().organization.getRuntimeSettings.handler(async () =>
    getRuntimeSettings(),
  ),

  setRuntimeSettings: requireInstallAdmin().organization.setRuntimeSettings.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
        runtime: {
          previewIdleTeardownHours: input.previewIdleTeardownHours,
          edgeLogRetentionDays: input.edgeLogRetentionDays,
          builderConcurrency: input.builderConcurrency,
        },
      });
      return saveRuntimeSettings({
        egressAllowlist: input.egressAllowlist,
        previewIdleTeardownHours: input.previewIdleTeardownHours,
        edgeLogPersist: input.edgeLogPersist,
        edgeLogRetentionDays: input.edgeLogRetentionDays,
        edgeLogGeoipUrl: input.edgeLogGeoipUrl,
        edgeLogGeoipAsnUrl: input.edgeLogGeoipAsnUrl,
        builderConcurrency: input.builderConcurrency,
      });
    },
  ),
};
