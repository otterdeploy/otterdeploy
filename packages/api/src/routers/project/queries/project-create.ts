/**
 * The project create transaction: the project row and its main environment,
 * written in the order `project_main_environment_in_project_fk` allows. Split
 * out of ./project.ts (row-level project/environment CRUD), which re-exports
 * it, so callers keep importing it from `./queries`.
 */
import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, project } from "@otterdeploy/db/schema/project";
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { and, eq, isNull } from "drizzle-orm";
import { createError } from "evlog";

import { ProjectEnvironmentUnavailableError } from "../errors";

/**
 * Create a project and its main environment, in one transaction.
 *
 * A supplied `environmentId` is honoured in two cases only: a
 * standalone environment this org made through `env.create` (claimed), or an
 * id no environment has yet (created under it, for optimistic UI). Every other
 * id, held by another project or standalone for another org (or for nobody we
 * can name), is refused with one error before anything is written.
 *
 * The write order is the one `project_main_environment_in_project_fk` allows
 * without a deferrable constraint: the environment row first (standalone),
 * then the project with no pointer, then the claim, then the pointer.
 */
export async function createProjectRecord(input: {
  organizationId: OrganizationId;
  name: string;
  slug: string;
  /** Caller-supplied ids for optimistic UI; generated when absent. */
  id?: ProjectId;
  environmentId?: EnvironmentId;
}): Promise<
  Result<
    { project: typeof project.$inferSelect; environment: typeof environment.$inferSelect },
    ProjectEnvironmentUnavailableError
  >
> {
  return db.transaction(async (tx) => {
    const projectId = input.id ?? createId(ID_PREFIX.project);
    const environmentId = input.environmentId ?? createId(ID_PREFIX.environment);

    // A fresh id becomes a standalone row of this org, the same row
    // `env.create` would have made; an existing id is left exactly as it is.
    await tx
      .insert(environment)
      .values({
        id: environmentId,
        // NOT `<projectSlug>-production`. Environment slugs are unique per
        // PROJECT (`environment_project_slug_unique`), so a project prefix
        // buys no uniqueness: it only leaks the project name into the
        // operator's URL (`?env=store-production`) for the one environment
        // every project has. It also disagreed with the other two creation
        // paths, which both write a bare `production`: the web onboarding
        // pre-allocates the row via `env.create`, and the create dialog
        // slugifies whatever the operator typed. Same concept, three code
        // paths, two different slugs, and the `slug === "production"`
        // lookups downstream silently missed the prefixed ones.
        name: "production",
        slug: "production",
        claimableByOrganizationId: input.organizationId,
      })
      .onConflictDoNothing({ target: environment.id });

    // Locked, so a concurrent create naming the same id waits here and then
    // finds it claimed, rather than both claiming it.
    const [claimable] = await tx
      .select({ id: environment.id })
      .from(environment)
      .where(
        and(
          eq(environment.id, environmentId),
          isNull(environment.projectId),
          eq(environment.claimableByOrganizationId, input.organizationId),
        ),
      )
      .for("update");
    if (!claimable) {
      return Result.err(new ProjectEnvironmentUnavailableError({ environmentId }));
    }

    const [created] = await tx
      .insert(project)
      .values({
        id: projectId,
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
      })
      .returning({ id: project.id });
    if (!created) {
      throw createError({
        message: "Failed to create project",
        status: 500,
        why: "Database insert returned no row for the new project",
      });
    }

    const [claimed] = await tx
      .update(environment)
      .set({ projectId, claimableByOrganizationId: null })
      .where(eq(environment.id, environmentId))
      .returning();
    const [pointed] = await tx
      .update(project)
      .set({ environmentId })
      .where(eq(project.id, projectId))
      .returning();
    if (!claimed || !pointed) {
      throw createError({
        message: "Failed to create default environment",
        status: 500,
        why: "Database update returned no row while linking the project and its main environment",
      });
    }

    return Result.ok({ project: pointed, environment: claimed });
  });
}
