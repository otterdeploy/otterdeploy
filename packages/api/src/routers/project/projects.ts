/**
 * Project CRUD orchestration. Thin wrapper over the project queries module
 * that produces wire-shaped `Project`s and surfaces lifecycle errors as
 * tagged `Result` values.
 */

import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { reconcile } from "../../caddy";
import { destroySwarmPostgres } from "../../swarm";

import {
  ProjectConflictError,
  ProjectNotFoundError,
  type ProjectId,
} from "./errors";
import {
  createProjectRecord,
  deleteProjectRecord,
  getProjectBySlug,
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
} from "./views";
import { type Id, ID_PREFIX } from "@otterstack/shared/id";

type OrgId = Id<typeof ID_PREFIX.organization>;

type OrgRef = {
  organizationId: OrgId;
};

export async function listProjects(input: OrgRef): Promise<Project[]> {
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

export async function createProject(
  input: OrgRef & { name: string; slug: string },
): Promise<Result<Project, ProjectConflictError>> {
  const slug = sanitizeProjectSlug(input.slug);
  const existing = await getProjectBySlug(slug);

  if (existing) {
    return Result.err(new ProjectConflictError({ slug }));
  }

  try {
    const created = await createProjectRecord({
      organizationId: input.organizationId,
      name: input.name.trim(),
      slug,
    });

    return Result.ok(created.project);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Result.err(new ProjectConflictError({ slug }));
    }

    throw error;
  }
}

export async function updateProject(
  input: { id: ProjectId; name?: string; slug?: string } & OrgRef,
): Promise<Result<Project, ProjectNotFoundError | ProjectConflictError>> {
  const slug =
    input.slug !== undefined ? sanitizeProjectSlug(input.slug) : undefined;
  const name = input.name !== undefined ? input.name.trim() : undefined;

  try {
    const updated = await updateProjectRecord({
      projectId: input.id,
      organizationId: input.organizationId,
      name,
      slug,
    });
    if (!updated) {
      return Result.err(new ProjectNotFoundError({ projectId: input.id }));
    }
    return Result.ok(updated);
  } catch (error) {
    if (isUniqueViolation(error) && slug !== undefined) {
      return Result.err(new ProjectConflictError({ slug }));
    }
    throw error;
  }
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
    await destroySwarmPostgres({ serviceName });
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
  await reconcile();

  log.set({
    teardown: {
      swarmServicesDestroyed: dbRecords.length,
      projectDeleted: true,
    },
  });

  return Result.ok({ ok: true });
}
