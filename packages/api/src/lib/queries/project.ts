import { asc, eq } from "drizzle-orm";

import { db } from "@otterstack/db";
import { environment, project } from "@otterstack/db/schema/project";
import { createId, ID_PREFIX } from "@otterstack/shared/id";

export async function listProjectRecords() {
  return db.select().from(project).orderBy(asc(project.createdAt), asc(project.name));
}

export async function getProjectById(projectId: string) {
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

export async function createProjectRecord(input: { name: string; slug: string }) {
  return db.transaction(async (tx) => {
    const projectId = createId(ID_PREFIX.project);
    const environmentId = createId(ID_PREFIX.environment);

    const [createdProject] = await tx
      .insert(project)
      .values({
        id: projectId,
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
