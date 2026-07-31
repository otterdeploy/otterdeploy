/**
 * Resolve the `environment` slug a caller passed into the id that scopes rows.
 *
 * The manifest API speaks slugs (`?environment=staging`) because that is what
 * an operator types and what the overlay block is keyed by. The resource tables
 * are scoped by id. This is the one place that converts between them, so the
 * conversion cannot drift between the diff endpoint and the apply endpoint —
 * which must agree, or a preview shows one plan and the deploy executes
 * another.
 *
 * Returns null for "the main environment", which is the same value that means
 * "no environment selected": main is stored as `environment_id IS NULL` so that
 * existing rows and names never had to change. An unknown slug also resolves to
 * null rather than throwing — the manifest overlay for a slug with no
 * environment row resolves to base anyway, so treating it as main keeps the two
 * halves consistent instead of failing one and not the other.
 */
import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, project } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

export async function environmentIdForSlug(
  projectId: ProjectId,
  slug: string | null | undefined,
): Promise<EnvironmentId | null> {
  if (!slug) return null;

  const [row] = await db
    .select({ id: environment.id })
    .from(environment)
    .where(and(eq(environment.projectId, projectId), eq(environment.slug, slug)))
    .limit(1);
  if (!row) return null;

  // The project's main environment is represented as base (NULL), so an
  // explicit `?environment=production` on a project whose main IS production
  // must resolve to null — not to production's own id, which would scope the
  // query to rows that do not exist.
  const [proj] = await db
    .select({ environmentId: project.environmentId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  return proj?.environmentId === row.id ? null : row.id;
}
