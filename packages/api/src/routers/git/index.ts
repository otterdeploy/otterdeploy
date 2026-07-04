import { ORPCError } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { gitInstallation, gitProvider, gitRepo } from "@otterdeploy/db/schema";
import { env } from "@otterdeploy/env/server";
import { matchError } from "better-result";
import { and, eq } from "drizzle-orm";

import { orgScopedProcedure } from "../..";
import {
  buildManifestRequest,
  disconnectGithubInstallation,
  GithubAppNotConfiguredError,
  GithubInstallationInvalidError,
  getInstallationToken,
  listInstallationRepos,
  loadGithubAppForInstallation,
  loadGithubAppForOrgIfPresent,
  lookupInstallation,
  signInstallState,
} from "../../git";
import { syncRepos } from "../../git/repos";
import { inspectEnvFiles, inspectRepoTree, listRepoBranches } from "./inspect";
import { connectPublicRepo } from "./public-repos";
import {
  getInstallationForOrg,
  getProviderDetail,
  listProvidersForOrg,
  listReposForInstallation,
  listResourcesForProvider,
} from "./queries";

export const gitRouter = {
  list: orgScopedProcedure.git.list.handler(async ({ context }) => {
    return listProvidersForOrg(context.activeOrganizationId);
  }),

  startConnect: orgScopedProcedure.git.startConnect.handler(
    async ({ input: _input, context, errors }) => {
      // The App slug is per-org, set when the manifest flow created the
      // provider row. No App → no slug → can't build an install URL.
      const [provider] = await db
        .select()
        .from(gitProvider)
        .where(
          and(
            eq(gitProvider.organizationId, context.activeOrganizationId),
            eq(gitProvider.kind, "github"),
          ),
        )
        .limit(1);
      if (!provider?.appSlug) {
        throw errors.NOT_CONFIGURED();
      }
      // App-install flow binds the GitHub callback to the initiating user —
      // session-only; API-key actors have no user identity.
      if (!context.session?.user) {
        throw new ORPCError("UNAUTHORIZED");
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
      const base = host === "github.com" ? "https://github.com" : `https://${host}`;
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
  startManifest: orgScopedProcedure.git.startManifest.handler(async ({ input, context }) => {
    // Manifest flow binds the GitHub callback to the initiating user —
    // session-only; API-key actors have no user identity.
    if (!context.session?.user) {
      throw new ORPCError("UNAUTHORIZED");
    }
    // GHE host (omit → github.com). Carried through the signed state so the
    // manifest callback exchanges the code against the right API + stores it.
    const host = input.host?.trim() || undefined;
    const state = await signInstallState({
      orgId: context.activeOrganizationId,
      userId: context.session.user.id,
      host,
    });
    // Browser-facing URLs (redirect/callback/setup) go to the control plane the
    // operator's browser can reach — the local `.localhost` address in dev.
    // Only the webhook URL must be public (GitHub's servers POST it), so that
    // one gets the tunnel (PUBLIC_API_URL); prod is single-origin and falls back.
    return buildManifestRequest({
      state,
      baseUrl: env.BETTER_AUTH_URL,
      webhookBaseUrl: env.PUBLIC_API_URL ?? env.BETTER_AUTH_URL,
      host,
      accountLogin: input.accountLogin ?? null,
      appName: input.appName,
    });
  }),

  disconnect: orgScopedProcedure.git.disconnect.handler(async ({ input, context, errors }) => {
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
  }),

  refreshRepos: orgScopedProcedure.git.refreshRepos.handler(async ({ input, context, errors }) => {
    const inst = await getInstallationForOrg({
      installationDbId: input.installationId,
      organizationId: context.activeOrganizationId,
    });
    if (!inst) throw errors.NOT_FOUND();
    context.log.set({
      target: { type: "git_installation", id: input.installationId },
    });

    try {
      const tokenResp = await getInstallationToken(inst.installation.installationId);
      const appConfig = await loadGithubAppForInstallation(inst.installation.installationId);
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
      // Installation gone on GitHub's side → tell the client to reinstall,
      // with a clear message (not a generic 500 "Internal server error").
      if (cause instanceof GithubInstallationInvalidError) {
        throw errors.REINSTALL_REQUIRED({ message: cause.message });
      }
      throw cause;
    }
  }),

  getProvider: orgScopedProcedure.git.getProvider.handler(async ({ input, context, errors }) => {
    const detail = await getProviderDetail({
      providerId: input.providerId,
      organizationId: context.activeOrganizationId,
    });
    if (!detail) throw errors.NOT_FOUND();
    const { provider: p, installation: inst } = detail;
    return {
      id: p.id,
      kind: p.kind,
      displayName: p.displayName,
      host: p.host,
      appSlug: p.appSlug,
      externalAppId: p.externalAppId,
      createdAt: p.createdAt,
      secretsConfigured: {
        clientSecret: Boolean(p.clientSecretCiphertext),
        webhookSecret: Boolean(p.webhookSecretCiphertext),
        privateKey: Boolean(p.privateKeyPemCiphertext),
      },
      installation: inst
        ? {
            id: inst.installation.id,
            providerId: inst.installation.providerId,
            installationId: inst.installation.installationId,
            accountLogin: inst.installation.accountLogin,
            accountType: inst.installation.accountType,
            accountAvatarUrl: inst.installation.accountAvatarUrl,
            repoSelection: inst.installation.repoSelection,
            permissions: inst.installation.permissions,
            repoCount: inst.repoCount,
            createdAt: inst.installation.createdAt,
            suspendedAt: inst.installation.suspendedAt,
            revokedAt: inst.installation.revokedAt,
          }
        : null,
    };
  }),

  refetchPermissions: orgScopedProcedure.git.refetchPermissions.handler(
    async ({ input, context, errors }) => {
      const inst = await getInstallationForOrg({
        installationDbId: input.installationId,
        organizationId: context.activeOrganizationId,
      });
      if (!inst) throw errors.NOT_FOUND();
      const appConfig = await loadGithubAppForOrgIfPresent(context.activeOrganizationId);
      if (!appConfig) throw errors.NOT_CONFIGURED();
      try {
        const lookup = await lookupInstallation(inst.installation.installationId, appConfig);
        const permissions = lookup.permissions ?? {};
        await db
          .update(gitInstallation)
          .set({ permissions })
          .where(eq(gitInstallation.id, inst.installation.id));
        return { permissions };
      } catch (cause) {
        if (cause instanceof GithubInstallationInvalidError) {
          throw errors.REINSTALL_REQUIRED({ message: cause.message });
        }
        throw cause;
      }
    },
  ),

  resources: orgScopedProcedure.git.resources.handler(async ({ input, context }) => {
    return listResourcesForProvider({
      providerId: input.providerId,
      organizationId: context.activeOrganizationId,
    });
  }),

  deleteProvider: orgScopedProcedure.git.deleteProvider.handler(
    async ({ input, context, errors }) => {
      // Cascade: installations are FK-cascade-deleted; git_repo rows keep their
      // history with installationId set null (FK is ON DELETE SET NULL).
      const deleted = await db
        .delete(gitProvider)
        .where(
          and(
            eq(gitProvider.id, input.providerId),
            eq(gitProvider.organizationId, context.activeOrganizationId),
          ),
        )
        .returning({ id: gitProvider.id });
      if (deleted.length === 0) throw errors.NOT_FOUND();
      return { ok: true };
    },
  ),

  listRepos: orgScopedProcedure.git.listRepos.handler(async ({ input, context, errors }) => {
    const inst = await getInstallationForOrg({
      installationDbId: input.installationId,
      organizationId: context.activeOrganizationId,
    });
    if (!inst) throw errors.NOT_FOUND();
    return listReposForInstallation(input.installationId);
  }),

  connectPublicRepo: orgScopedProcedure.git.connectPublicRepo.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "git_public_repo" } });
      const result = await connectPublicRepo({ cloneUrl: input.cloneUrl });
      if (result.isErr()) {
        // Operator-supplied URL was rejected — surface the message so
        // the form can show what's wrong (missing owner/repo, http://, …).
        throw errors.INVALID_URL({ message: result.error.message });
      }
      return result.value;
    },
  ),

  inspectRepo: orgScopedProcedure.git.inspectRepo.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "git_repo", id: input.gitRepoId, path: input.path },
    });
    const result = await inspectRepoTree({
      gitRepoId: input.gitRepoId,
      path: input.path,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        InspectRepoNotFoundError: () => errors.NOT_FOUND(),
        InspectRepoRateLimitedError: (err) => errors.RATE_LIMITED({ message: err.message }),
        InspectRepoUpstreamError: (err) => errors.UPSTREAM({ message: err.message }),
      });
    }
    return result.value;
  }),

  listBranches: orgScopedProcedure.git.listBranches.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "git_repo", id: input.gitRepoId },
    });
    const result = await listRepoBranches(input.gitRepoId);
    if (result.isErr()) {
      throw matchError(result.error, {
        InspectRepoNotFoundError: () => errors.NOT_FOUND(),
        InspectRepoRateLimitedError: (err) => errors.RATE_LIMITED({ message: err.message }),
        InspectRepoUpstreamError: (err) => errors.UPSTREAM({ message: err.message }),
      });
    }
    return result.value;
  }),

  getRepo: orgScopedProcedure.git.getRepo.handler(async ({ input, errors }) => {
    const [row] = await db
      .select({
        fullName: gitRepo.fullName,
        defaultBranch: gitRepo.defaultBranch,
      })
      .from(gitRepo)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(eq(gitRepo.id, input.gitRepoId as any))
      .limit(1);
    if (!row) throw errors.NOT_FOUND();
    return {
      fullName: row.fullName,
      defaultBranch: row.defaultBranch ?? "main",
    };
  }),

  inspectEnv: orgScopedProcedure.git.inspectEnv.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "git_repo", id: input.gitRepoId, path: input.path },
    });
    const result = await inspectEnvFiles(input.gitRepoId, input.path);
    if (result.isErr()) {
      throw matchError(result.error, {
        InspectRepoNotFoundError: () => errors.NOT_FOUND(),
        InspectRepoRateLimitedError: (err) => errors.RATE_LIMITED({ message: err.message }),
        InspectRepoUpstreamError: (err) => errors.UPSTREAM({ message: err.message }),
      });
    }
    return result.value;
  }),
};
