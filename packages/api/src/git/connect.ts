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

import { db } from "@otterstack/db";
import { gitInstallation, gitProvider } from "@otterstack/db/schema";
import { ID_PREFIX, type Id } from "@otterstack/shared/id";
import { and, eq } from "drizzle-orm";

import {
  getInstallationToken,
  listInstallationRepos,
  lookupInstallation,
} from "./github-app";
import { syncRepos } from "./repos";

export interface CompleteConnectArgs {
  organizationId: Id<typeof ID_PREFIX.organization>;
  installationId: string;
}

export interface CompleteConnectResult {
  providerId: Id<typeof ID_PREFIX.gitProvider>;
  installationDbId: Id<typeof ID_PREFIX.gitInstallation>;
  accountLogin: string;
  repoCount: number;
}

export async function completeGithubConnect(
  args: CompleteConnectArgs,
): Promise<CompleteConnectResult> {
  const installation = await lookupInstallation(args.installationId);

  // Provider — one per (org, kind). Upsert by the unique index.
  const provider = await db
    .insert(gitProvider)
    .values({
      organizationId: args.organizationId,
      kind: "github",
      displayName: `GitHub (${installation.account.login})`,
    })
    .onConflictDoUpdate({
      target: [gitProvider.organizationId, gitProvider.kind],
      set: {
        displayName: `GitHub (${installation.account.login})`,
      },
    })
    .returning();
  const providerRow = provider[0];
  if (!providerRow) {
    throw new Error("Failed to upsert git_provider row");
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
  const repos = await listInstallationRepos(tokenResp.token);
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
  organizationId: Id<typeof ID_PREFIX.organization>;
  installationDbId: Id<typeof ID_PREFIX.gitInstallation>;
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
