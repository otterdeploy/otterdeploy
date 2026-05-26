import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { createError } from "evlog";

import { db } from "@otterstack/db";
import {
  environment,
  project,
  projectEnvVar,
  resource,
} from "@otterstack/db/schema/project";
import { createId, ID_PREFIX, type Id } from "@otterstack/shared/id";

import type { ProjectId } from "../errors";

export async function listProjectRecordsByOrg(organizationId: Id<typeof ID_PREFIX.organization>) {
  return db
    .select({
      id: project.id,
      name: project.name,
      slug: project.slug,
      environmentId: project.environmentId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      databaseCount: sql<number>`coalesce(sum(case when ${resource.type} = 'database' then 1 else 0 end), 0)::int`,
    })
    .from(project)
    .leftJoin(resource, eq(resource.projectId, project.id))
    .where(eq(project.organizationId, organizationId))
    .groupBy(project.id)
    .orderBy(asc(project.createdAt), asc(project.name));
}

/**
 * Loads a project by id and verifies it belongs to the given organization.
 * Returns undefined if no project exists or it belongs to a different org.
 */
export async function getProjectInOrg(input: {
  projectId: ProjectId;
  organizationId: Id<typeof ID_PREFIX.organization>;
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

export async function getProjectBySlug(slug: string) {
  const [record] = await db.select().from(project).where(eq(project.slug, slug)).limit(1);
  return record;
}

export async function getProjectBySlugInOrg(input: {
  slug: string;
  organizationId: Id<typeof ID_PREFIX.organization>;
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
  organizationId: Id<typeof ID_PREFIX.organization>;
  name?: string;
  slug?: string;
}) {
  const [record] = await db
    .update(project)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.slug !== undefined && { slug: input.slug }),
    })
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .returning();
  return record;
}

export async function deleteProjectRecord(input: {
  projectId: ProjectId;
  organizationId: Id<typeof ID_PREFIX.organization>;
}) {
  const [record] = await db
    .delete(project)
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .returning({ id: project.id });
  return record;
}

export async function createProjectRecord(input: {
  organizationId: Id<typeof ID_PREFIX.organization>;
  name: string;
  slug: string;
  /** Caller-supplied ids for optimistic UI; generated when absent. */
  id?: ProjectId;
  environmentId?: Id<typeof ID_PREFIX.environment>;
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
  environmentId: Id<typeof ID_PREFIX.environment>;
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
