/**
 * Project CRUD orchestration. Thin wrapper over the project queries module
 * that produces wire-shaped `Project`s and surfaces lifecycle errors as
 * tagged `Result` values.
 */

import type { ContainerRegistryId, EnvironmentId, GitRepoId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import { and, eq } from "drizzle-orm";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import {
  containerRegistry,
  gitInstallation,
  gitProvider,
  gitRepo,
  type NixpacksConfig,
} from "@otterdeploy/db/schema";

import { reconcile } from "../../caddy";
import { destroySwarmPostgres } from "../../runtime/db";

import { ProjectConflictError, ProjectInvalidBindingError, ProjectNotFoundError } from "./errors";
import {
  createProjectRecord,
  deleteProjectRecord,
  getProjectBySlugInOrg,
  getProjectInOrg,
  listDatabaseResourceRecords,
  listProjectRecordsByOrg,
  setProjectGraphLayout,
  updateProjectRecord,
} from "./queries";

import type { OrgRef } from "../scopes";
import {
  buildContainerName,
  isUniqueViolation,
  sanitizeProjectSlug,
  type Project,
  type ProjectListItem,
} from "./views";
type OrgId = OrganizationId;
type RegistryId = ContainerRegistryId;

export async function listProjects(input: OrgRef): Promise<ProjectListItem[]> {
  return listProjectRecordsByOrg(input.organizationId);
}

export async function getProject(
  input: { id: ProjectId } & OrgRef,
): Promise<Result<Project, ProjectNotFoundError>> {
  const record = await getProjectInOrg({
    projectId: input.id,
    organizationId: input.organizationId,
  });
  if (!record) {
    return Result.err(new ProjectNotFoundError({ projectId: input.id }));
  }
  return Result.ok(record);
}

export async function getProjectBySlugForOrg(
  input: { slug: string } & OrgRef,
): Promise<Result<Project, ProjectNotFoundError>> {
  const record = await getProjectBySlugInOrg({
    slug: input.slug,
    organizationId: input.organizationId,
  });
  if (!record) {
    // We don't have the projectId yet, so pass the slug through as the
    // identifying detail for the error.
    return Result.err(
      new ProjectNotFoundError({
        projectId: input.slug as unknown as ProjectId,
      }),
    );
  }
  return Result.ok(record);
}

export async function createProject(
  input: OrgRef & {
    name: string;
    slug: string;
    id?: ProjectId;
    environmentId?: EnvironmentId;
  },
): Promise<Result<Project, ProjectConflictError>> {
  // Slug uniqueness is org-scoped, so a sibling org owning the same slug is fine.
  const existing = await getProjectBySlugInOrg({
    slug: input.slug,
    organizationId: input.organizationId,
  });

  if (existing) {
    return Result.err(new ProjectConflictError({ slug: input.slug }));
  }

  try {
    const created = await createProjectRecord({
      organizationId: input.organizationId,
      name: input.name.trim(),
      slug: input.slug,
      id: input.id,
      environmentId: input.environmentId,
    });

    return Result.ok(created.project);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Result.err(new ProjectConflictError({ slug: input.slug }));
    }

    throw error;
  }
}

export async function updateProject(
  input: {
    id: ProjectId;
    name?: string;
    slug?: string;
    customDomain?: string | null;
    gitRepoId?: string | null;
    productionBranch?: string;
    containerRegistryId?: string | null;
    imageRepository?: string | null;
    nixpacksConfig?: NixpacksConfig | null;
  } & OrgRef,
): Promise<
  Result<
    Project,
    ProjectNotFoundError | ProjectConflictError | ProjectInvalidBindingError
  >
> {
  const name = input.name !== undefined ? input.name.trim() : undefined;

  // Validate FK rows belong to this org BEFORE writing — the columns
  // are application-managed (no DB FK) so a stray id would otherwise
  // silently bind to a stranger's row.
  if (input.gitRepoId) {
    const ok = await repoBelongsToOrg(input.gitRepoId, input.organizationId);
    if (!ok) {
      return Result.err(new ProjectInvalidBindingError({ field: "gitRepoId" }));
    }
  }
  if (input.containerRegistryId) {
    const ok = await registryBelongsToOrg(
      input.containerRegistryId,
      input.organizationId,
    );
    if (!ok) {
      return Result.err(
        new ProjectInvalidBindingError({ field: "containerRegistryId" }),
      );
    }
  }

  try {
    const updated = await updateProjectRecord({
      projectId: input.id,
      organizationId: input.organizationId,
      name,
      slug: input.slug,
      customDomain:
        input.customDomain !== undefined
          ? input.customDomain?.trim().toLowerCase() || null
          : undefined,
      gitRepoId: input.gitRepoId,
      productionBranch: input.productionBranch,
      containerRegistryId: input.containerRegistryId,
      imageRepository:
        input.imageRepository !== undefined ? input.imageRepository?.trim() ?? null : undefined,
      nixpacksConfig: input.nixpacksConfig,
    });
    if (!updated) {
      return Result.err(new ProjectNotFoundError({ projectId: input.id }));
    }
    return Result.ok(updated);
  } catch (error) {
    if (isUniqueViolation(error) && input.slug !== undefined) {
      return Result.err(new ProjectConflictError({ slug: input.slug }));
    }
    throw error;
  }
}

/**
 * Merge operator-dragged node positions into the project's stored graph
 * layout. Partial map in (only the nodes that moved); the rest of the layout
 * is preserved. Shared per project — see the `graphLayout` column.
 */
export async function saveProjectGraphLayout(
  input: OrgRef & {
    projectId: ProjectId;
    positions: Record<string, { x: number; y: number }>;
  },
): Promise<Result<{ ok: true }, ProjectNotFoundError>> {
  const record = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!record) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  const merged = { ...(record.graphLayout ?? {}), ...input.positions };
  await setProjectGraphLayout({
    projectId: input.projectId,
    organizationId: input.organizationId,
    graphLayout: merged,
  });
  return Result.ok({ ok: true });
}

async function repoBelongsToOrg(
  gitRepoId: string,
  organizationId: string,
): Promise<boolean> {
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
        eq(gitProvider.organizationId, organizationId as OrgId),
      ),
    )
    .limit(1);
  return owned !== undefined;
}

async function registryBelongsToOrg(
  registryId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: containerRegistry.id })
    .from(containerRegistry)
    .where(
      and(
        eq(containerRegistry.id, registryId as RegistryId),
        eq(containerRegistry.organizationId, organizationId as OrgId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function deleteProject(
  input: { id: ProjectId } & OrgRef,
  log: RequestLogger,
): Promise<Result<{ ok: true }, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.id,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.id }));
  }

  const projectSlug = sanitizeProjectSlug(project.slug);
  const dbRecords = await listDatabaseResourceRecords(input.id);

  // 1. Tear down each child postgres Swarm service before dropping DB rows.
  //    FK cascade handles environment / resource / database_resource / proxy_route.
  for (const record of dbRecords) {
    const serviceName = buildContainerName({
      engine: record.database.engine,
      projectSlug,
      resourceName: record.resource.name,
    });
    await destroySwarmPostgres({ serviceName }, log);
  }

  // 2. Delete the project row — FKs cascade to children.
  const deleted = await deleteProjectRecord({
    projectId: input.id,
    organizationId: input.organizationId,
  });
  if (!deleted) {
    return Result.err(new ProjectNotFoundError({ projectId: input.id }));
  }

  // 3. Refresh Caddy so removed proxy routes drop out of the live config.
  await reconcile(log);

  log.set({
    teardown: {
      swarmServicesDestroyed: dbRecords.length,
      projectDeleted: true,
    },
  });

  return Result.ok({ ok: true });
}
