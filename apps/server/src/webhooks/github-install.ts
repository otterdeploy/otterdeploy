/**
 * GitHub App install callback.
 *
 * After the operator clicks "Install" on GitHub, GitHub redirects to this
 * endpoint with `installation_id`, `setup_action`, and our signed `state`.
 *
 * Verifies the state, runs the connect orchestration, then redirects back
 * to the providers page with a success/error query param. The response is
 * always a redirect — no JSON — because the user's browser is following
 * the GitHub-side redirect chain.
 */

import {
  completeGithubConnect,
  completeManifestExchange,
  GithubAppNotConfiguredError,
  signInstallState,
  verifyInstallState,
} from "@otterstack/api/git";
import { env } from "@otterstack/env/server";
import { ID_PREFIX, type Id } from "@otterstack/shared/id";
import { log, parseError } from "evlog";
import { type EvlogVariables } from "evlog/hono";
import type { Hono } from "hono";

export function registerGithubInstallRoutes(app: Hono<EvlogVariables>): void {
  app.get("/api/integrations/github/install/callback", async (c) => {
    const installationId = c.req.query("installation_id");
    const setupAction = c.req.query("setup_action");
    const stateRaw = c.req.query("state");

    // Default redirect target for both success and failure. The /providers
    // page reads the query string to surface a toast.
    const baseUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");
    const errorRedirect = (reason: string) =>
      c.redirect(`${baseUrl}/?git_install=error&reason=${encodeURIComponent(reason)}`);

    if (!installationId || !setupAction || !stateRaw) {
      return errorRedirect("missing-params");
    }

    const state = await verifyInstallState(stateRaw);
    if (!state) {
      return errorRedirect("invalid-state");
    }

    if (setupAction !== "install" && setupAction !== "update") {
      return errorRedirect(`unsupported-action:${setupAction}`);
    }

    try {
      const result = await completeGithubConnect({
        organizationId: state.orgId as Id<typeof ID_PREFIX.organization>,
        installationId,
      });
      log.info({
        github: {
          event: "install.completed",
          installationId,
          orgId: state.orgId,
          accountLogin: result.accountLogin,
          repoCount: result.repoCount,
        },
      });
      return c.redirect(`${baseUrl}/?git_install=ok`);
    } catch (cause) {
      if (cause instanceof GithubAppNotConfiguredError) {
        return errorRedirect("app-not-configured");
      }
      const parsed = parseError(cause);
      log.error({
        github: {
          event: "install.failed",
          installationId,
          error: parsed.message,
        },
      });
      return errorRedirect(`failed:${parsed.code ?? "unknown"}`);
    }
  });

  /**
   * Manifest-flow callback — GitHub redirects here after the operator
   * approves the App creation page with our manifest. Exchanges the
   * one-time `code` for App credentials, persists them encrypted on
   * the org's `git_provider` row, then redirects the operator on to
   * the install URL so they can pick repos.
   *
   * `state` is verified the same way as the install callback above —
   * same signing scheme, same TTL.
   */
  app.get("/api/integrations/github/manifest/callback", async (c) => {
    const code = c.req.query("code");
    const stateRaw = c.req.query("state");

    const baseUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");
    const errorRedirect = (reason: string) =>
      c.redirect(
        `${baseUrl}/?git_install=error&reason=${encodeURIComponent(reason)}`,
      );

    if (!code || !stateRaw) {
      return errorRedirect("missing-params");
    }

    const state = await verifyInstallState(stateRaw);
    if (!state) {
      return errorRedirect("invalid-state");
    }

    try {
      const result = await completeManifestExchange({
        code,
        organizationId: state.orgId as Id<typeof ID_PREFIX.organization>,
      });
      log.info({
        github: {
          event: "manifest.completed",
          orgId: state.orgId,
          providerId: result.providerId,
          appSlug: result.appSlug,
        },
      });

      // Carry the install state forward — same orgId + userId — so the
      // install-callback can finish wiring this org's first installation.
      // Mint fresh because the manifest-leg state has already burned
      // most of its 15-minute TTL.
      const installState = await signInstallState({
        orgId: state.orgId,
        userId: state.userId,
      });
      const installUrl = new URL(result.installRedirectUrl);
      installUrl.searchParams.set("state", installState);
      return c.redirect(installUrl.toString());
    } catch (cause) {
      const parsed = parseError(cause);
      log.error({
        github: {
          event: "manifest.failed",
          orgId: state.orgId,
          error: parsed.message,
        },
      });
      return errorRedirect(`manifest-failed:${parsed.code ?? "unknown"}`);
    }
  });
}
