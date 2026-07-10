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
import type { Handler } from "hono";

import {
  completeGithubConnect,
  completeManifestExchange,
  GithubAppNotConfiguredError,
  signInstallState,
  verifyInstallState,
} from "@otterdeploy/api/git";
import { resolveCanonicalWebOrigin } from "@otterdeploy/auth/web-origin";
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { log, parseError } from "evlog";

// These callbacks run on the public ingress (the tunnel in dev), then bounce
// the browser back to the dashboard. That target is the WEB origin — the
// VERIFIED control-plane FQDN when the operator has set one (keeps the raw
// server IP out of browser redirects); otherwise the env resolution: in dev
// BETTER_AUTH_URL is the API host, so prefer PUBLIC_WEB_URL when set (prod
// single-origin installs leave it unset and fall back).
const dashboardUrl = () =>
  resolveCanonicalWebOrigin((env.PUBLIC_WEB_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, ""));

// `returnTo` is a signed, sanitized app-relative path — when present, the
// operator gets dropped back where they started the connect (e.g. the deploy
// wizard) instead of the Git providers page.
const resultRedirectUrl = async (params: {
  status: "ok" | "error";
  reason?: string;
  returnTo?: string;
}) => {
  const url = new URL(`${await dashboardUrl()}${params.returnTo ?? "/"}`);
  url.searchParams.set("git_install", params.status);
  if (params.reason) url.searchParams.set("reason", params.reason);
  return url.toString();
};
const errorRedirectUrl = (reason: string, returnTo?: string) =>
  resultRedirectUrl({ status: "error", reason, returnTo });

// ─── /api/integrations/github/install/callback ──────────────────────

export const githubInstallCallbackHandler: Handler = async (c) => {
  const installationId = c.req.query("installation_id");
  const setupAction = c.req.query("setup_action");
  const stateRaw = c.req.query("state");

  if (!installationId || !setupAction || !stateRaw) {
    return c.redirect(await errorRedirectUrl("missing-params"));
  }

  const state = await verifyInstallState(stateRaw);
  if (!state) {
    return c.redirect(await errorRedirectUrl("invalid-state"));
  }

  if (setupAction !== "install" && setupAction !== "update") {
    return c.redirect(await errorRedirectUrl(`unsupported-action:${setupAction}`, state.returnTo));
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
      return c.redirect(await errorRedirectUrl("app-not-configured", state.returnTo));
    }
    const parsed = parseError(connect.error);
    log.error({
      github: { event: "install.failed", installationId, error: parsed.message },
    });
    return c.redirect(await errorRedirectUrl(`failed:${parsed.code ?? "unknown"}`, state.returnTo));
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
  return c.redirect(await resultRedirectUrl({ status: "ok", returnTo: state.returnTo }));
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
    return c.redirect(await errorRedirectUrl("missing-params"));
  }

  const state = await verifyInstallState(stateRaw);
  if (!state) {
    return c.redirect(await errorRedirectUrl("invalid-state"));
  }

  const exchange = await Result.tryPromise({
    try: () =>
      completeManifestExchange({
        code,
        organizationId: state.orgId as OrganizationId,
        host: state.host,
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (exchange.isErr()) {
    const parsed = parseError(exchange.error);
    log.error({
      github: { event: "manifest.failed", orgId: state.orgId, error: parsed.message },
    });
    return c.redirect(
      await errorRedirectUrl(`manifest-failed:${parsed.code ?? "unknown"}`, state.returnTo),
    );
  }

  log.info({
    github: {
      event: "manifest.completed",
      orgId: state.orgId,
      providerId: exchange.value.providerId,
      appSlug: exchange.value.appSlug,
    },
  });

  // Carry the install state forward — same orgId + userId + returnTo — so
  // the install-callback can finish wiring this org's first installation.
  // Mint fresh because the manifest-leg state has already burned most
  // of its 15-minute TTL.
  const installState = await signInstallState({
    orgId: state.orgId,
    userId: state.userId,
    returnTo: state.returnTo,
  });
  const installUrl = new URL(exchange.value.installRedirectUrl);
  installUrl.searchParams.set("state", installState);
  return c.redirect(installUrl.toString());
};
