import { and, asc, eq } from "drizzle-orm";

import { db } from "@otterstack/db";
import { environment, project } from "@otterstack/db/schema/project";
import { createId, ID_PREFIX } from "@otterstack/shared/id";

import type { ProjectId } from "../errors";

export async function listProjectRecordsByOrg(organizationId: string) {
  return db
    .select()
    .from(project)
    .where(eq(project.organizationId, organizationId))
    .orderBy(asc(project.createdAt), asc(project.name));
}

/**
 * Loads a project by id and verifies it belongs to the given organization.
 * Returns undefined if no project exists or it belongs to a different org.
 */
export async function getProjectInOrg(input: {
  projectId: ProjectId;
  organizationId: string;
}) {
  const [record] = await db
    .select()
    .from(project)
    .where(
      and(
        eq(project.id, input.projectId),
        eq(project.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return record;
}

export async function getProjectById(projectId: ProjectId) {
  const [record] = await db
    .select()
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  return record;
}

/** Alias for getProjectById — kept so existing call sites continue to read naturally. */
export const getProjectRecord = getProjectById;

export async function getProjectBySlug(slug: string) {
  const [record] = await db
    .select()
    .from(project)
    .where(eq(project.slug, slug))
    .limit(1);
  return record;
}

export async function createProjectRecord(input: {
  organizationId: string;
  name: string;
  slug: string;
}) {
  return db.transaction(async (tx) => {
    const projectId = createId(ID_PREFIX.project);
    const environmentId = createId(ID_PREFIX.environment);

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
      throw new Error("Failed to create project.");
    }

    const [createdEnvironment] = await tx
      .insert(environment)
      .values({
        id: environmentId,
        projectId,
        name: "Development",
        slug: `${input.slug}-development`,
      })
      .returning();

    if (!createdEnvironment) {
      throw new Error("Failed to create default environment.");
    }

    return {
      project: createdProject,
      environment: createdEnvironment,
    };
  });
}
