/**
 * GitHub App install + manifest callbacks.
 *
 * Both endpoints are browser redirects (no JSON) following the GitHub
 * OAuth-style chain. Errors redirect back to the dashboard with a
 * `?git_install=error&reason=...` query so the UI can surface a toast.
 *
 *   install/callback   GitHub sends installation_id after "Install"
 *   manifest/callback  GitHub sends App credentials after manifest approval
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import {
  completeGithubConnect,
  completeManifestExchange,
  GithubAppNotConfiguredError,
  signInstallState,
  verifyInstallState,
} from "@otterdeploy/api/git";
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { log, parseError } from "evlog";
import type { Handler } from "hono";

const baseUrl = () => env.BETTER_AUTH_URL.replace(/\/$/, "");
const errorRedirectUrl = (reason: string) =>
  `${baseUrl()}/?git_install=error&reason=${encodeURIComponent(reason)}`;

// ─── /api/integrations/github/install/callback ──────────────────────

export const githubInstallCallbackHandler: Handler = async (c) => {
  const installationId = c.req.query("installation_id");
  const setupAction = c.req.query("setup_action");
  const stateRaw = c.req.query("state");

  if (!installationId || !setupAction || !stateRaw) {
    return c.redirect(errorRedirectUrl("missing-params"));
  }

  const state = await verifyInstallState(stateRaw);
  if (!state) {
    return c.redirect(errorRedirectUrl("invalid-state"));
  }

  if (setupAction !== "install" && setupAction !== "update") {
    return c.redirect(errorRedirectUrl(`unsupported-action:${setupAction}`));
  }

  const connect = await Result.tryPromise({
    try: () =>
      completeGithubConnect({
        organizationId: state.orgId as OrganizationId,
        installationId,
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (connect.isErr()) {
    if (connect.error instanceof GithubAppNotConfiguredError) {
      return c.redirect(errorRedirectUrl("app-not-configured"));
    }
    const parsed = parseError(connect.error);
    log.error({
      github: { event: "install.failed", installationId, error: parsed.message },
    });
    return c.redirect(errorRedirectUrl(`failed:${parsed.code ?? "unknown"}`));
  }

  log.info({
    github: {
      event: "install.completed",
      installationId,
      orgId: state.orgId,
      accountLogin: connect.value.accountLogin,
      repoCount: connect.value.repoCount,
    },
  });
  return c.redirect(`${baseUrl()}/?git_install=ok`);
};

// ─── /api/integrations/github/manifest/callback ─────────────────────
// GitHub redirects here after the operator approves the App creation
// page with our manifest. Exchanges the one-time `code` for App
// credentials, persists them encrypted on the org's `git_provider`
// row, then redirects on to the install URL so they can pick repos.

export const githubManifestCallbackHandler: Handler = async (c) => {
  const code = c.req.query("code");
  const stateRaw = c.req.query("state");

  if (!code || !stateRaw) {
    return c.redirect(errorRedirectUrl("missing-params"));
  }

  const state = await verifyInstallState(stateRaw);
  if (!state) {
    return c.redirect(errorRedirectUrl("invalid-state"));
  }

  const exchange = await Result.tryPromise({
    try: () =>
      completeManifestExchange({
        code,
        organizationId: state.orgId as OrganizationId,
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (exchange.isErr()) {
    const parsed = parseError(exchange.error);
    log.error({
      github: { event: "manifest.failed", orgId: state.orgId, error: parsed.message },
    });
    return c.redirect(errorRedirectUrl(`manifest-failed:${parsed.code ?? "unknown"}`));
  }

  log.info({
    github: {
      event: "manifest.completed",
      orgId: state.orgId,
      providerId: exchange.value.providerId,
      appSlug: exchange.value.appSlug,
    },
  });

  // Carry the install state forward — same orgId + userId — so the
  // install-callback can finish wiring this org's first installation.
  // Mint fresh because the manifest-leg state has already burned most
  // of its 15-minute TTL.
  const installState = await signInstallState({
    orgId: state.orgId,
    userId: state.userId,
  });
  const installUrl = new URL(exchange.value.installRedirectUrl);
  installUrl.searchParams.set("state", installState);
  return c.redirect(installUrl.toString());
};
