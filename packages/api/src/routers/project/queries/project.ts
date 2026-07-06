import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  environment,
  project,
  projectEnvVar,
  resource,
  type NixpacksConfig,
} from "@otterdeploy/db/schema/project";
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createError } from "evlog";

import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";

export async function listProjectRecordsByOrg(organizationId: OrganizationId) {
  return db
    .select({
      id: project.id,
      name: project.name,
      slug: project.slug,
      environmentId: project.environmentId,
      stackFile: project.stackFile,
      stackFileVersion: project.stackFileVersion,
      lastAppliedFile: project.lastAppliedFile,
      lastAppliedAt: project.lastAppliedAt,
      customDomain: project.customDomain,
      customDomainVerifiedAt: project.customDomainVerifiedAt,
      customDomainVerifyToken: project.customDomainVerifyToken,
      nixpacksConfig: project.nixpacksConfig,
      graphLayout: project.graphLayout,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      // Correlated subqueries rather than one leftJoin + GROUP BY: joining both
      // `resource` and `proxy_route` would fan them into each other's rows and
      // multiply the tallies. Each count is an independent scalar subquery.
      databaseCount: sql<number>`(select count(*) from ${resource} where ${resource.projectId} = ${project.id} and ${resource.type} = 'database')::int`,
      // A "service" is a service OR a compose resource — a compose stack is one
      // authored unit even though it fans out to several containers at runtime.
      serviceCount: sql<number>`(select count(*) from ${resource} where ${resource.projectId} = ${project.id} and ${resource.type} in ('service', 'compose'))::int`,
      // Enabled routes only: disabled/custom-pending routes never reach the edge.
      routeCount: sql<number>`(select count(*) from ${proxyRoute} where ${proxyRoute.projectId} = ${project.id} and ${proxyRoute.enabled} = true)::int`,
    })
    .from(project)
    .where(eq(project.organizationId, organizationId))
    .orderBy(asc(project.createdAt), asc(project.name));
}

/**
 * `(id, projectId)` for every service/compose resource in the org. The project
 * list's "running" tally is computed against these ids: a resource counts as
 * running when at least one managed container carries its
 * `otterdeploy.resource.id` label (see `listProjects`).
 */
export async function listServiceResourceRefsByOrg(organizationId: OrganizationId) {
  return db
    .select({ id: resource.id, projectId: resource.projectId })
    .from(resource)
    .innerJoin(project, eq(resource.projectId, project.id))
    .where(
      and(
        eq(project.organizationId, organizationId),
        inArray(resource.type, ["service", "compose"]),
      ),
    );
}

/**
 * Loads a project by id and verifies it belongs to the given organization.
 * Returns undefined if no project exists or it belongs to a different org.
 */
export async function getProjectInOrg(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
}) {
  const [record] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .limit(1);
  return record;
}

export async function getProjectById(projectId: ProjectId) {
  const [record] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
  return record;
}

/** Alias for getProjectById — kept so existing call sites continue to read naturally. */
export const getProjectRecord = getProjectById;

/** Load a single environment row by id. Used by the variable resolver to read
 *  an env's `baseEnvironmentId` (for inherit-by-reference). */
export async function getEnvironmentById(environmentId: EnvironmentId) {
  const [record] = await db
    .select()
    .from(environment)
    .where(eq(environment.id, environmentId))
    .limit(1);
  return record;
}

export async function getProjectBySlugInOrg(input: {
  slug: string;
  organizationId: OrganizationId;
}) {
  const [record] = await db
    .select()
    .from(project)
    .where(and(eq(project.slug, input.slug), eq(project.organizationId, input.organizationId)))
    .limit(1);
  return record;
}

export async function updateProjectRecord(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
  name?: string;
  slug?: string;
  customDomain?: string | null;
  gitRepoId?: string | null;
  productionBranch?: string;
  containerRegistryId?: string | null;
  imageRepository?: string | null;
  nixpacksConfig?: NixpacksConfig | null;
}) {
  // Build the patch object incrementally so undefined fields stay
  // unset (drizzle/postgres treat undefined as "no column update").
  const patch: Partial<typeof project.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.customDomain !== undefined) {
    patch.customDomain = input.customDomain;
    // Changing the bound domain invalidates any previous verification —
    // operator has to re-prove ownership of the new one. `null` clears
    // back to org fallback, also no verification needed.
    patch.customDomainVerifiedAt = null;
    patch.customDomainVerifyToken = null;
  }
  if (input.nixpacksConfig !== undefined) patch.nixpacksConfig = input.nixpacksConfig;

  if (Object.keys(patch).length === 0) {
    // No-op: return the current row so the caller still gets the view shape.
    const [row] = await db
      .select()
      .from(project)
      .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
      .limit(1);
    return row;
  }

  const [record] = await db
    .update(project)
    .set(patch)
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .returning();
  return record;
}

/** Overwrite the project's whole graph-layout map (callers merge first). */
export async function setProjectGraphLayout(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
  graphLayout: Record<string, { x: number; y: number }>;
}) {
  const [record] = await db
    .update(project)
    .set({ graphLayout: input.graphLayout })
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .returning({ id: project.id });
  return record;
}

export async function deleteProjectRecord(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
}) {
  const [record] = await db
    .delete(project)
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .returning({ id: project.id });
  return record;
}

export async function createProjectRecord(input: {
  organizationId: OrganizationId;
  name: string;
  slug: string;
  /** Caller-supplied ids for optimistic UI; generated when absent. */
  id?: ProjectId;
  environmentId?: EnvironmentId;
}) {
  return db.transaction(async (tx) => {
    const projectId = input.id ?? createId(ID_PREFIX.project);
    const environmentId = input.environmentId ?? createId(ID_PREFIX.environment);

    const [createdProject] = await tx
      .insert(project)
      .values({
        id: projectId,
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
        environmentId,
      })
      .returning();

    if (!createdProject) {
      throw createError({
        message: "Failed to create project",
        status: 500,
        why: "Database insert returned no row for the new project",
      });
    }

    // If the caller pre-allocated an env id via env.create, claim that
    // standalone row by stamping the projectId. Otherwise insert a fresh row.
    let createdEnvironment: typeof environment.$inferSelect | undefined;

    if (input.environmentId) {
      const [linked] = await tx
        .update(environment)
        .set({ projectId })
        .where(and(eq(environment.id, environmentId), isNull(environment.projectId)))
        .returning();
      createdEnvironment = linked;
    }

    if (!createdEnvironment) {
      const [inserted] = await tx
        .insert(environment)
        .values({
          id: environmentId,
          projectId,
          name: "Development",
          slug: `${input.slug}-development`,
        })
        .returning();
      createdEnvironment = inserted;
    }

    if (!createdEnvironment) {
      throw createError({
        message: "Failed to create default environment",
        status: 500,
        why: "Database insert returned no row for the default environment",
      });
    }

    return {
      project: createdProject,
      environment: createdEnvironment,
    };
  });
}

/**
 * Load all project-level env vars for the given (project, environment)
 * pair, flattened to a plain `Record<string,string>`. Used by the variable
 * resolver to back `${{project.X}}` and `${{environment.X}}` references —
 * both magic names resolve from this same bag today (a project carries
 * exactly one environment row), keeping the door open for per-environment
 * specialization when multi-env projects ship.
 *
 * Returns an empty record when nothing is configured. Secrets are not
 * specially masked here — values are emitted verbatim into the container
 * env, which is the only way a workload can actually consume them.
 */
export async function loadProjectEnvBag(input: {
  projectId: ProjectId;
  environmentId: EnvironmentId;
}): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: projectEnvVar.key, value: projectEnvVar.value })
    .from(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.projectId, input.projectId),
        eq(projectEnvVar.environmentId, input.environmentId),
      ),
    );
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}
