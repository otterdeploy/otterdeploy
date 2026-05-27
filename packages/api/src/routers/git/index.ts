import { db } from "@otterstack/db";
import { gitProvider } from "@otterstack/db/schema";
import { and, eq } from "drizzle-orm";

import { env } from "@otterstack/env/server";

import { orgScopedProcedure } from "../..";
import {
  buildManifestRequest,
  disconnectGithubInstallation,
  GithubAppNotConfiguredError,
  getInstallationToken,
  listInstallationRepos,
  loadGithubAppForInstallation,
  signInstallState,
} from "../../git";
import { syncRepos } from "../../git/repos";

import {
  getInstallationForOrg,
  listProvidersForOrg,
  listReposForInstallation,
} from "./queries";

export const gitRouter = {
  list: orgScopedProcedure.git.list.handler(async ({ context }) => {
    return listProvidersForOrg(context.activeOrganizationId);
  }),

  startConnect: orgScopedProcedure.git.startConnect.handler(
    async ({ input: _input, context, errors }) => {
      // The App slug is per-org, set when the manifest flow created the
      // provider row. No App → no slug → can't build an install URL.
      const provider = await db.query.gitProvider.findFirst({
        where: and(
          eq(gitProvider.organizationId, context.activeOrganizationId),
          eq(gitProvider.kind, "github"),
        ),
      });
      if (!provider?.appSlug) {
        throw errors.NOT_CONFIGURED();
      }
      const state = await signInstallState({
        orgId: context.activeOrganizationId,
        userId: context.session.user.id,
      });
      // GitHub App install URL — the user picks repos on GitHub, then GitHub
      // redirects to the App's configured callback URL with installation_id +
      // setup_action + our state param. Built off the host on the provider
      // row so future GHE installs Just Work.
      const host = provider.host;
      const base =
        host === "github.com"
          ? "https://github.com"
          : `https://${host}`;
      const url = new URL(`${base}/apps/${provider.appSlug}/installations/new`);
      url.searchParams.set("state", state);
      return { redirectUrl: url.toString() };
    },
  ),

  /**
   * Manifest flow — first half. Returns the form-action URL + manifest
   * JSON so the UI can auto-submit a form to GitHub's app-creation
   * page. GitHub then redirects to the callback registered at
   * `/api/integrations/github/manifest/callback`, which finishes the
   * exchange and persists the row.
   *
   * No NOT_CONFIGURED error — this endpoint IS the configuration path.
   * It runs even when no provider row exists yet (the common case for
   * a fresh install).
   */
  startManifest: orgScopedProcedure.git.startManifest.handler(
    async ({ input, context }) => {
      const state = await signInstallState({
        orgId: context.activeOrganizationId,
        userId: context.session.user.id,
      });
      const baseUrl = env.BETTER_AUTH_URL;
      return buildManifestRequest({
        state,
        baseUrl,
        accountLogin: input.accountLogin ?? null,
        appName: input.appName,
      });
    },
  ),

  disconnect: orgScopedProcedure.git.disconnect.handler(
    async ({ input, context, errors }) => {
      const inst = await getInstallationForOrg({
        installationDbId: input.installationId,
        organizationId: context.activeOrganizationId,
      });
      if (!inst) throw errors.NOT_FOUND();
      context.log.set({
        target: { type: "git_installation", id: input.installationId },
      });
      await disconnectGithubInstallation({
        organizationId: context.activeOrganizationId,
        installationDbId: input.installationId,
      });
      return { ok: true };
    },
  ),

  refreshRepos: orgScopedProcedure.git.refreshRepos.handler(
    async ({ input, context, errors }) => {
      const inst = await getInstallationForOrg({
        installationDbId: input.installationId,
        organizationId: context.activeOrganizationId,
      });
      if (!inst) throw errors.NOT_FOUND();
      context.log.set({
        target: { type: "git_installation", id: input.installationId },
      });

      try {
        const tokenResp = await getInstallationToken(
          inst.installation.installationId,
        );
        const appConfig = await loadGithubAppForInstallation(
          inst.installation.installationId,
        );
        const repos = await listInstallationRepos(tokenResp.token, appConfig);
        await syncRepos(
          inst.installation.id,
          repos.map((r) => ({
            id: r.id,
            node_id: r.node_id,
            full_name: r.full_name,
            name: r.name,
            private: r.private,
            default_branch: r.default_branch,
            clone_url: r.clone_url,
          })),
        );
        return { repoCount: repos.length };
      } catch (cause) {
        if (cause instanceof GithubAppNotConfiguredError) {
          throw errors.NOT_CONFIGURED();
        }
        throw cause;
      }
    },
  ),

  listRepos: orgScopedProcedure.git.listRepos.handler(
    async ({ input, context, errors }) => {
      const inst = await getInstallationForOrg({
        installationDbId: input.installationId,
        organizationId: context.activeOrganizationId,
      });
      if (!inst) throw errors.NOT_FOUND();
      return listReposForInstallation(input.installationId);
    },
  ),
};
