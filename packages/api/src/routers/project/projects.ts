/**
 * Project CRUD orchestration. Thin wrapper over the project queries module
 * that produces wire-shaped `Project`s and surfaces lifecycle errors as
 * tagged `Result` values.
 */

import { Result } from "better-result";
import { and, eq } from "drizzle-orm";
import type { RequestLogger } from "evlog";

import { db } from "@otterstack/db";
import {
  containerRegistry,
  gitInstallation,
  gitProvider,
  gitRepo,
  type NixpacksConfig,
} from "@otterstack/db/schema";

import { reconcile } from "../../caddy";
import { destroySwarmPostgres } from "../../swarm";

import {
  ProjectConflictError,
  ProjectInvalidBindingError,
  ProjectNotFoundError,
  type ProjectId,
} from "./errors";
import {
  createProjectRecord,
  deleteProjectRecord,
  getProjectBySlug,
  getProjectBySlugInOrg,
  getProjectInOrg,
  listDatabaseResourceRecords,
  listProjectRecordsByOrg,
  updateProjectRecord,
} from "./queries";

import {
  buildContainerName,
  isUniqueViolation,
  sanitizeProjectSlug,
  type Project,
  type ProjectListItem,
} from "./views";
import { type Id, ID_PREFIX } from "@otterstack/shared/id";

type OrgId = Id<typeof ID_PREFIX.organization>;
type GitRepoId = Id<typeof ID_PREFIX.gitRepo>;
type RegistryId = Id<typeof ID_PREFIX.containerRegistry>;

interface OrgRef {
  organizationId: OrgId;
}

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
    environmentId?: Id<typeof ID_PREFIX.environment>;
  },
): Promise<Result<Project, ProjectConflictError>> {
  const existing = await getProjectBySlug(input.slug);

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

async function repoBelongsToOrg(
  gitRepoId: string,
  organizationId: string,
): Promise<boolean> {
  // org ownership lives on git_provider, not git_installation —
  // join through both.
  const [row] = await db
    .select({ id: gitRepo.id })
    .from(gitRepo)
    .innerJoin(gitInstallation, eq(gitInstallation.id, gitRepo.installationId))
    .innerJoin(gitProvider, eq(gitProvider.id, gitInstallation.providerId))
    .where(
      and(
        eq(gitRepo.id, gitRepoId as GitRepoId),
        eq(gitProvider.organizationId, organizationId as OrgId),
      ),
    )
    .limit(1);
  return row !== undefined;
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
