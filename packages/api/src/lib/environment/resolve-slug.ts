/**
 * Resolve the `environment` slug a caller passed into the id that scopes rows.
 *
 * The manifest API speaks slugs (`?environment=staging`) because that is what
 * an operator types and what the overlay block is keyed by. The resource tables
 * are scoped by id. This is the one place that converts between them, so the
 * conversion cannot drift between the diff endpoint and the apply endpoint,
 * which must agree, or a preview shows one plan and the deploy executes
 * another.
 *
 * Returns null for "the main environment", which is the same value that means
 * "no environment selected": main is stored as `environment_id IS NULL` so that
 * existing rows and names never had to change.
 *
 * An UNKNOWN slug is an error, not null. It used to resolve to null on the
 * reasoning that the overlay for a slug with no environment row resolves to
 * base anyway, so treating it as main kept both halves consistent. That holds
 * for a read. It is catastrophic for an apply: a manifest describing ONE
 * environment, sent with a slug that does not match — a typo, or the display
 * name `Staging` where the slug is `staging` — silently scoped to MAIN, and
 * every resource the manifest did not mention was deleted from production.
 * Observed in the wild exactly that way.
 *
 * Consistency between the two halves is preserved by failing both, which is
 * the safe direction. `null`/`undefined` still means main, so every caller
 * that omits the argument is unaffected.
 */
import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, project } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

/**
 * A slug that matches no environment on this project. Carries the valid slugs
 * because the mistake is nearly always a near-miss (`Staging` for `staging`),
 * and a message that lists the real ones ends the guessing.
 */
export class UnknownEnvironmentError extends Error {
  readonly requested: string;
  readonly available: readonly string[];
  constructor(requested: string, available: readonly string[]) {
    super(
      available.length === 0
        ? `No environment "${requested}" on this project, which has none.`
        : `No environment "${requested}" on this project. Available: ${available.join(", ")}.`,
    );
    this.name = "UnknownEnvironmentError";
    this.requested = requested;
    this.available = available;
  }
}

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
  if (!row) {
    const available = await db
      .select({ slug: environment.slug })
      .from(environment)
      .where(eq(environment.projectId, projectId));
    throw new UnknownEnvironmentError(
      slug,
      available.map((e) => e.slug),
    );
  }

  // The project's main environment is represented as base (NULL), so an
  // explicit `?environment=production` on a project whose main IS production
  // must resolve to null, not to production's own id, which would scope the
  // query to rows that do not exist.
  const [proj] = await db
    .select({ environmentId: project.environmentId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  return proj?.environmentId === row.id ? null : row.id;
}
