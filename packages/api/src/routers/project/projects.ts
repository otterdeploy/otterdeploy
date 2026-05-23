/**
 * Project CRUD orchestration. Thin wrapper over the project queries module
 * that produces wire-shaped `ProjectView`s and surfaces lifecycle errors as
 * tagged `Result` values.
 */

import { Result } from "better-result";

import {
  ProjectConflictError,
  ProjectNotFoundError,
  type ProjectId,
} from "./errors";
import {
  createProjectRecord,
  getProjectBySlug,
  getProjectInOrg,
  listProjectRecordsByOrg,
} from "./queries";
import {
  isUniqueViolation,
  mapProject,
  sanitizeProjectSlug,
  type ProjectView,
} from "./views";

type OrgRef = {
  organizationId: string;
};

export async function listProjects(input: OrgRef): Promise<ProjectView[]> {
  const records = await listProjectRecordsByOrg(input.organizationId);
  return records.map((record) => mapProject(record));
}

export async function getProject(
  input: { id: ProjectId } & OrgRef,
): Promise<Result<ProjectView, ProjectNotFoundError>> {
  const record = await getProjectInOrg({
    projectId: input.id,
    organizationId: input.organizationId,
  });
  if (!record) {
    return Result.err(new ProjectNotFoundError({ projectId: input.id }));
  }
  return Result.ok(mapProject(record));
}

export async function createProject(
  input: OrgRef & { name: string; slug: string },
): Promise<Result<ProjectView, ProjectConflictError>> {
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

    return Result.ok(mapProject(created.project));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Result.err(new ProjectConflictError({ slug }));
    }

    throw error;
  }
}
