/**
 * Project CRUD orchestration. Thin wrapper over the project queries module
 * that produces wire-shaped `Project`s and surfaces lifecycle errors as
 * tagged `Result` values.
 */

import type { EnvironmentId, ProjectId, ServerId } from "@otterdeploy/shared/id";

import { type NixpacksConfig } from "@otterdeploy/db/schema";
import { panic, Result } from "better-result";
import * as z from "zod";

import type { OrgRef } from "../scopes";

import {
  ProjectConflictError,
  ProjectEnvironmentUnavailableError,
  ProjectNotFoundError,
} from "./errors";
import { normalizeCustomDomain } from "./projects-bindings";
import {
  countEnabledRoutesByProject,
  countResourcesByProject,
  createProjectRecord,
  getProjectBySlugInOrg,
  getProjectInOrg,
  isProjectSlugTaken,
  listProjectRecordsByOrg,
  setProjectGraphLayout,
  suggestFreeProjectSlug,
  updateProjectRecord,
} from "./queries";
import { countRunningServicesByProject } from "./running-services";
import { isUniqueViolation, type Project, type ProjectListItem } from "./views";

export async function listProjects(input: OrgRef): Promise<ProjectListItem[]> {
  const [records, resourceTallies, routeTallies, running] = await Promise.all([
    listProjectRecordsByOrg(input.organizationId),
    countResourcesByProject(input.organizationId),
    countEnabledRoutesByProject(input.organizationId),
    countRunningServicesByProject(input.organizationId),
  ]);
  return records.map((r) => ({
    ...r,
    // A project with no resources/routes has no group row at all. Absent means 0.
    databaseCount: resourceTallies.get(r.id)?.databaseCount ?? 0,
    serviceCount: resourceTallies.get(r.id)?.serviceCount ?? 0,
    routeCount: routeTallies.get(r.id) ?? 0,
    // null (docker unreachable) propagates to every project so the UI hides the
    // running fraction rather than lying with a 0.
    runningServiceCount: running ? (running.get(r.id) ?? 0) : null,
  }));
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

/** See the comment at its use: brands a slug standing in for a missing id. */
const slugStandingInForProjectId = z.custom<ProjectId>((v) => typeof v === "string");

export async function getProjectBySlugForOrg(
  input: { slug: string } & OrgRef,
): Promise<Result<Project, ProjectNotFoundError>> {
  const record = await getProjectBySlugInOrg({
    slug: input.slug,
    organizationId: input.organizationId,
  });
  if (!record) {
    // We don't have the projectId yet, so pass the slug through as the
    // identifying detail for the error. `ProjectNotFoundError` insists on a
    // branded ProjectId it can't actually have on a slug miss (callers only
    // surface NOT_FOUND; the id lands in the message), so the slug is branded
    // through an explicit runtime-checked schema rather than a type assertion.
    return Result.err(
      new ProjectNotFoundError({
        projectId: slugStandingInForProjectId.parse(input.slug),
      }),
    );
  }
  return Result.ok(record);
}

async function slugConflict(slug: string): Promise<ProjectConflictError> {
  return new ProjectConflictError({ slug, suggestedSlug: await suggestFreeProjectSlug(slug) });
}

export async function createProject(
  input: OrgRef & {
    name: string;
    slug: string;
    id?: ProjectId;
    environmentId?: EnvironmentId;
    importedFrom?: string;
  },
): Promise<Result<Project, ProjectConflictError | ProjectEnvironmentUnavailableError>> {
  // Slug uniqueness is install-wide, not per org: the slug alone
  // names the project's swarm services, network and volumes, so a sibling org
  // owning the same slug would share them. `project_slug_unique` backs this
  // check against a concurrent create.
  if (await isProjectSlugTaken(input.slug)) {
    return Result.err(await slugConflict(input.slug));
  }

  const created = await Result.tryPromise({
    try: () =>
      createProjectRecord({
        organizationId: input.organizationId,
        name: input.name.trim(),
        slug: input.slug,
        id: input.id,
        environmentId: input.environmentId,
        importedFrom: input.importedFrom,
      }),
    catch: async (cause) =>
      isUniqueViolation(cause)
        ? slugConflict(input.slug)
        : panic("project.create: unexpected database error", cause),
  });
  if (created.isErr()) return Result.err(created.error);
  return created.value.map((record) => record.project);
}

export async function updateProject(
  input: {
    id: ProjectId;
    name?: string;
    slug?: string;
    customDomain?: string | null;
    nixpacksConfig?: NixpacksConfig | null;
    buildServerId?: ServerId | null;
  } & OrgRef,
): Promise<Result<Project, ProjectNotFoundError | ProjectConflictError>> {
  const name = input.name !== undefined ? input.name.trim() : undefined;

  try {
    const updated = await updateProjectRecord({
      projectId: input.id,
      organizationId: input.organizationId,
      name,
      slug: input.slug,
      customDomain: normalizeCustomDomain(input.customDomain),
      nixpacksConfig: input.nixpacksConfig,
      buildServerId: input.buildServerId,
    });
    if (!updated) {
      return Result.err(new ProjectNotFoundError({ projectId: input.id }));
    }
    return Result.ok(updated);
  } catch (error) {
    if (isUniqueViolation(error) && input.slug !== undefined) {
      return Result.err(await slugConflict(input.slug));
    }
    throw error;
  }
}

/**
 * Merge operator-dragged node positions into the project's stored graph
 * layout. Partial map in (only the nodes that moved); the rest of the layout
 * is preserved. Shared per project. See the `graphLayout` column.
 */
export async function saveProjectGraphLayout(
  input: OrgRef & {
    projectId: ProjectId;
    positions: Record<string, { x: number; y: number }>;
    /** Replace the stored layout wholesale instead of merging. `{}` resets
     *  every saved position so dagre owns placement again. */
    replace?: boolean;
  },
): Promise<Result<{ ok: true }, ProjectNotFoundError>> {
  const record = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!record) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  const merged = input.replace
    ? { ...input.positions }
    : { ...record.graphLayout, ...input.positions };
  await setProjectGraphLayout({
    projectId: input.projectId,
    organizationId: input.organizationId,
    graphLayout: merged,
  });
  return Result.ok({ ok: true });
}

export { deleteProject } from "./project-delete";
