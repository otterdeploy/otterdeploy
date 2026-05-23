/**
 * Lookup helpers used by every handler — load the project (and optionally
 * the service record) for the (org, project, resource) addressing tuple,
 * surfacing a typed `Result` instead of `undefined` checks.
 */

import { Result } from "better-result";

import { ProjectNotFoundError } from "../project/errors";
import { getProjectInOrg } from "../project/queries";

import { ServiceNotFoundError } from "./errors";
import { type ProjectRef, type ResourceRef } from "./inputs";
import { getServiceRecord, type ServiceRecord } from "./queries";

export type ProjectRow = NonNullable<Awaited<ReturnType<typeof getProjectInOrg>>>;

/** Loads the project row for the (projectId, organizationId) pair, or errors. */
export async function loadProject(
  input: ProjectRef,
): Promise<Result<ProjectRow, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  return Result.ok(project);
}

/** Loads both {project, record} for a `ResourceRef`, or errors. */
export async function loadResource(
  input: ResourceRef,
): Promise<
  Result<
    { project: ProjectRow; record: ServiceRecord },
    ProjectNotFoundError | ServiceNotFoundError
  >
> {
  const project = await loadProject(input);
  if (project.isErr()) return Result.err(project.error);

  const record = await getServiceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new ServiceNotFoundError({ resourceId: input.resourceId }));
  }
  return Result.ok({ project: project.value, record });
}
