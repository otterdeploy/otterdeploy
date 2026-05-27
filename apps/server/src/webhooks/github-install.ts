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
  GithubAppNotConfiguredError,
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
}
