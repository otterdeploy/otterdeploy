
import type { GitInstallationId, OrganizationId } from "@otterdeploy/shared/id";
import { db } from "@otterdeploy/db";
import {
  gitInstallation,
  gitProvider,
  gitRepo,
} from "@otterdeploy/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

export async function listProvidersForOrg(
  organizationId: OrganizationId,
) {
  const providers = await db.query.gitProvider.findMany({
    where: eq(gitProvider.organizationId, organizationId),
    orderBy: asc(gitProvider.createdAt),
  });
  if (providers.length === 0) return [];

  const providerIds = providers.map((p) => p.id);
  const installations = await db
    .select({
      installation: gitInstallation,
      repoCount: sql<number>`coalesce((select count(*) from ${gitRepo} where ${gitRepo.installationId} = ${gitInstallation.id}), 0)::int`,
    })
    .from(gitInstallation)
    .where(inArray(gitInstallation.providerId, providerIds));

  return providers.map((p) => ({
    id: p.id,
    kind: p.kind,
    displayName: p.displayName,
    createdAt: p.createdAt,
    installations: installations
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

export async function listReposForInstallation(
  installationDbId: GitInstallationId,
) {
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
