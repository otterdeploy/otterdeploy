import type { GitInstallationId, GitProviderId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  gitInstallation,
  gitProvider,
  gitRepo,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

export async function listProvidersForOrg(organizationId: OrganizationId) {
  const providers = await db
    .select()
    .from(gitProvider)
    .where(eq(gitProvider.organizationId, organizationId))
    .orderBy(asc(gitProvider.createdAt));
  if (providers.length === 0) return [];

  const providerIds = providers.map((p) => p.id);
  const installations = await db
    .select({
      installation: gitInstallation,
      repoCount: sql<number>`coalesce((select count(*) from ${gitRepo} where ${gitRepo.installationId} = ${gitInstallation.id}), 0)::int`,
    })
    .from(gitInstallation)
    .where(inArray(gitInstallation.providerId, providerIds))
    .orderBy(asc(gitInstallation.createdAt));

  // A reinstall mints a fresh GitHub installation id, so the disconnected
  // account's soft-revoked row (kept for deploy history) would sit next to
  // its active replacement forever. Show a revoked row only while the same
  // account has no active installation — as a "this is dead, reinstall" cue.
  const accountKey = (i: typeof gitInstallation.$inferSelect) =>
    `${i.providerId}:${i.accountType}/${i.accountLogin}`;
  const activeAccounts = new Set(
    installations.filter((r) => !r.installation.revokedAt).map((r) => accountKey(r.installation)),
  );
  const visible = installations.filter(
    (r) => !r.installation.revokedAt || !activeAccounts.has(accountKey(r.installation)),
  );

  return providers.map((p) => ({
    id: p.id,
    kind: p.kind,
    displayName: p.displayName,
    createdAt: p.createdAt,
    installations: visible
      .filter((row) => row.installation.providerId === p.id)
      .map((row) => ({
        id: row.installation.id,
        providerId: row.installation.providerId,
        installationId: row.installation.installationId,
        accountLogin: row.installation.accountLogin,
        accountType: row.installation.accountType,
        accountAvatarUrl: row.installation.accountAvatarUrl,
        repoSelection: row.installation.repoSelection,
        suspendedAt: row.installation.suspendedAt,
        revokedAt: row.installation.revokedAt,
        createdAt: row.installation.createdAt,
        repoCount: row.repoCount,
      })),
  }));
}

export async function getInstallationForOrg(args: {
  installationDbId: GitInstallationId;
  organizationId: OrganizationId;
}) {
  const inst = await db
    .select({ installation: gitInstallation, provider: gitProvider })
    .from(gitInstallation)
    .innerJoin(gitProvider, eq(gitProvider.id, gitInstallation.providerId))
    .where(
      and(
        eq(gitInstallation.id, args.installationDbId),
        eq(gitProvider.organizationId, args.organizationId),
      ),
    )
    .limit(1);
  return inst[0];
}

/** Full provider row + its (single) installation with repo count — powers the
 *  GitHub App detail page. Returns null when the provider isn't in this org. */
export async function getProviderDetail(args: {
  providerId: GitProviderId;
  organizationId: OrganizationId;
}) {
  const [provider] = await db
    .select()
    .from(gitProvider)
    .where(
      and(eq(gitProvider.id, args.providerId), eq(gitProvider.organizationId, args.organizationId)),
    )
    .limit(1);
  if (!provider) return null;

  // Prefer the newest ACTIVE installation — after a reinstall the oldest row
  // is the soft-revoked leftover, which would wrongly front the detail page.
  const [installation] = await db
    .select({
      installation: gitInstallation,
      repoCount: sql<number>`coalesce((select count(*) from ${gitRepo} where ${gitRepo.installationId} = ${gitInstallation.id}), 0)::int`,
    })
    .from(gitInstallation)
    .where(eq(gitInstallation.providerId, provider.id))
    .orderBy(sql`(${gitInstallation.revokedAt} is not null) asc`, desc(gitInstallation.createdAt))
    .limit(1);

  return { provider, installation: installation ?? null };
}

/** Projects deploying from a repo owned by this provider's installation —
 *  the "Resources" tab. */
export async function listResourcesForProvider(args: {
  providerId: GitProviderId;
  organizationId: OrganizationId;
}) {
  // Repo binding lives on services now — list the (project, repo, branch) each
  // git service bound to this provider's repos deploys from. Distinct so a
  // project with several services on the same repo+branch collapses to one row,
  // while a project deploying from multiple repos yields one row per repo.
  return db
    .selectDistinct({
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
      productionBranch: serviceResource.branch,
      repoFullName: gitRepo.fullName,
    })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .innerJoin(gitRepo, eq(gitRepo.id, serviceResource.gitRepoId))
    .innerJoin(gitInstallation, eq(gitInstallation.id, gitRepo.installationId))
    .where(
      and(
        eq(gitInstallation.providerId, args.providerId),
        eq(project.organizationId, args.organizationId),
      ),
    )
    .orderBy(asc(project.name));
}

export async function listReposForInstallation(installationDbId: GitInstallationId) {
  return db
    .select({
      id: gitRepo.id,
      fullName: gitRepo.fullName,
      defaultBranch: gitRepo.defaultBranch,
      isPrivate: gitRepo.isPrivate,
      cloneUrl: gitRepo.cloneUrl,
    })
    .from(gitRepo)
    .where(eq(gitRepo.installationId, installationDbId))
    .orderBy(asc(gitRepo.fullName));
}
