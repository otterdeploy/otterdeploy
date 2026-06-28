/**
 * FK-binding validation + field normalization for project updates. The
 * gitRepo / containerRegistry columns are application-managed (no DB FK), so a
 * stray id would silently bind to a stranger's row — these guards verify org
 * ownership BEFORE the update writes.
 */
import type { ContainerRegistryId, GitRepoId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { containerRegistry, gitInstallation, gitProvider, gitRepo } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";

import { ProjectInvalidBindingError } from "./errors";

async function repoBelongsToOrg(gitRepoId: string, organizationId: string): Promise<boolean> {
  // Two valid shapes:
  //
  //   1. Installation-backed row → org ownership lives on git_provider;
  //      join through git_installation + git_provider and require a
  //      match on organizationId.
  //
  //   2. Public-URL row → installationId is null (no provider, no
  //      org); the row is intentionally tenant-shared because the data
  //      is public. Isolation is enforced at the project binding
  //      level, not at the gitRepo row. Just verify the row exists.
  const [row] = await db
    .select({ id: gitRepo.id, installationId: gitRepo.installationId })
    .from(gitRepo)
    .where(eq(gitRepo.id, gitRepoId as GitRepoId))
    .limit(1);
  if (!row) return false;
  if (row.installationId == null) return true;

  const [owned] = await db
    .select({ id: gitProvider.id })
    .from(gitInstallation)
    .innerJoin(gitProvider, eq(gitProvider.id, gitInstallation.providerId))
    .where(
      and(
        eq(gitInstallation.id, row.installationId),
        eq(gitProvider.organizationId, organizationId as OrganizationId),
      ),
    )
    .limit(1);
  return owned !== undefined;
}

async function registryBelongsToOrg(registryId: string, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: containerRegistry.id })
    .from(containerRegistry)
    .where(
      and(
        eq(containerRegistry.id, registryId as ContainerRegistryId),
        eq(containerRegistry.organizationId, organizationId as OrganizationId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Validate the FK rows on a project update belong to the org. Returns the
 *  binding error to surface, or null when every supplied id is owned. */
export async function validateProjectBindings(input: {
  organizationId: string;
  gitRepoId?: string | null;
  containerRegistryId?: string | null;
}): Promise<ProjectInvalidBindingError | null> {
  if (input.gitRepoId) {
    const ok = await repoBelongsToOrg(input.gitRepoId, input.organizationId);
    if (!ok) return new ProjectInvalidBindingError({ field: "gitRepoId" });
  }
  if (input.containerRegistryId) {
    const ok = await registryBelongsToOrg(input.containerRegistryId, input.organizationId);
    if (!ok) return new ProjectInvalidBindingError({ field: "containerRegistryId" });
  }
  return null;
}

/** Normalize a customDomain patch value — undefined passes through (no
 *  change); anything else trims + lowercases, collapsing empty to null. */
export function normalizeCustomDomain(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim().toLowerCase() || null;
}

/** Normalize an imageRepository patch value — undefined passes through (no
 *  change); anything else trims, collapsing null/missing to null. */
export function normalizeImageRepository(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() ?? null;
}
