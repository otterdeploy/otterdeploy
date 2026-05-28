/**
 * Connect-flow orchestration. Runs after the operator finishes the
 * GitHub-side install and lands back on our callback:
 *
 *   1. lookup the installation via the App JWT
 *   2. mint a short-lived installation token, list accessible repos
 *   3. upsert gitProvider (org's choice of provider)
 *   4. insert/refresh gitInstallation bound to that provider
 *   5. sync gitRepo rows
 *
 * Idempotent: re-running for the same (org, installationId) refreshes
 * metadata without duplicating rows.
 */

import type { GitInstallationId, GitProviderId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitInstallation, gitProvider } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";

import {
  getInstallationToken,
  GithubAppNotConfiguredError,
  listInstallationRepos,
  lookupInstallation,
} from "./github-app";
import { loadGithubAppForOrgIfPresent } from "./github-app-config";
import { syncRepos } from "./repos";

export interface CompleteConnectArgs {
  organizationId: OrganizationId;
  installationId: string;
}

export interface CompleteConnectResult {
  providerId: GitProviderId;
  installationDbId: GitInstallationId;
  accountLogin: string;
  repoCount: number;
}

export async function completeGithubConnect(
  args: CompleteConnectArgs,
): Promise<CompleteConnectResult> {
  // The provider row must already exist for this org — the manifest flow
  // creates it before the operator hits "Install" on GitHub. If we got
  // here without one, the operator skipped the create-app step (or the
  // manifest callback failed and we still got redirected to install).
  const appConfig = await loadGithubAppForOrgIfPresent(args.organizationId);
  if (!appConfig) {
    throw new GithubAppNotConfiguredError(
      `no github provider row for org ${args.organizationId}`,
    );
  }

  const installation = await lookupInstallation(args.installationId, appConfig);

  // Provider — upserted by the manifest flow already. Refresh the display
  // name so it tracks the connected account.
  const provider = await db
    .update(gitProvider)
    .set({ displayName: `GitHub (${installation.account.login})` })
    .where(
      and(
        eq(gitProvider.organizationId, args.organizationId),
        eq(gitProvider.kind, "github"),
      ),
    )
    .returning();
  const providerRow = provider[0];
  if (!providerRow) {
    throw new Error("Provider row vanished between manifest callback and install");
  }

  // Installation — upsert by GitHub installation id (unique).
  const inst = await db
    .insert(gitInstallation)
    .values({
      providerId: providerRow.id,
      installationId: args.installationId,
      accountLogin: installation.account.login,
      accountType:
        installation.account.type === "Organization" ? "organization" : "user",
      accountAvatarUrl: installation.account.avatar_url ?? null,
      repoSelection: installation.repository_selection,
      permissions: installation.permissions ?? {},
      suspendedAt: null,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: gitInstallation.installationId,
      set: {
        providerId: providerRow.id,
        accountLogin: installation.account.login,
        accountType:
          installation.account.type === "Organization" ? "organization" : "user",
        accountAvatarUrl: installation.account.avatar_url ?? null,
        repoSelection: installation.repository_selection,
        permissions: installation.permissions ?? {},
        suspendedAt: null,
        revokedAt: null,
      },
    })
    .returning();
  const instRow = inst[0];
  if (!instRow) {
    throw new Error("Failed to upsert git_installation row");
  }

  // Sync repos via a fresh installation token.
  const tokenResp = await getInstallationToken(args.installationId);
  const repos = await listInstallationRepos(tokenResp.token, appConfig);
  await syncRepos(
    instRow.id,
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

  return {
    providerId: providerRow.id,
    installationDbId: instRow.id,
    accountLogin: instRow.accountLogin,
    repoCount: repos.length,
  };
}

/**
 * Soft-revoke: clear the installation's link to its repos but keep the
 * row for audit. Phase 3 needs this too — historic deployments can still
 * resolve their source repo by id even after disconnect.
 */
export async function disconnectGithubInstallation(args: {
  organizationId: OrganizationId;
  installationDbId: GitInstallationId;
}): Promise<void> {
  // Verify the installation belongs to a provider in this org.
  const inst = await db.query.gitInstallation.findFirst({
    where: eq(gitInstallation.id, args.installationDbId),
    with: { provider: true },
  });
  if (!inst) return;
  const providerOrg = await db.query.gitProvider.findFirst({
    where: and(
      eq(gitProvider.id, inst.providerId),
      eq(gitProvider.organizationId, args.organizationId),
    ),
  });
  if (!providerOrg) {
    throw new Error("Installation does not belong to this organization");
  }

  await db
    .update(gitInstallation)
    .set({ revokedAt: new Date() })
    .where(eq(gitInstallation.id, args.installationDbId));
}
