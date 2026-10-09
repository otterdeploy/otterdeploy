/**
 * The environment a NEW resource row belongs to.
 *
 * `resource.environment_id` is nullable, and the read path treats null as the
 * project's main environment (web's `inActiveEnvironment`, the server's
 * `inEnvironmentScope`). That tolerance is what kept a live database reachable
 * on 2026-08-10 (od-lqm) — but tolerance on the read side is not a reason to
 * write an unscoped row. A resource should carry the environment it belongs
 * to, or the next scoped view that is written without the null fallback loses
 * it again.
 *
 * So every `resource` insert resolves through here instead of persisting a
 * caller's omitted `environmentId` verbatim. Deep links, the CLI and the
 * direct wizard routes all omit it; the postgres create stream was fixed for
 * this once, in its own stage, while the service and compose inserts still
 * wrote null. One helper, one rule, no path left to drift.
 *
 * A SUPPLIED environment is checked, not trusted. It must be an
 * environment of this very project: an id from another project, another
 * organization, or no environment at all is refused here, before any row
 * exists. Written verbatim, such an id strands the resource: every scoped read
 * matches `environment_id = <the environment being viewed>`, so the row
 * vanishes from every list while its container keeps running and its name
 * stays taken. The database backstops this with a composite foreign key
 * (`resource_environment_in_project_fk`); this check exists so the
 * caller gets a typed refusal instead of a constraint violation.
 *
 * "This project" also covers "this organization": a project belongs to exactly
 * one org, and every caller has already resolved the project inside the
 * caller's org. Another org's environment therefore always belongs to another
 * project, and gets the same refusal. That refusal does not say which of the
 * three it was, so a probe cannot learn that a foreign id exists.
 *
 * Returns null only for a project with no `environment_id` pointer at all,
 * which `project.create` has always set.
 *
 * Deliberately a leaf: it imports the db, the schema and ids and nothing else,
 * so the three routers that call it cannot gain an import cycle from doing so.
 */
import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, project } from "@otterdeploy/db/schema/project";
import { Result, TaggedError } from "better-result";
import { and, eq } from "drizzle-orm";

/** A requested environment that is not one of the project's own. */
export class ResourceEnvironmentNotFoundError extends TaggedError(
  "ResourceEnvironmentNotFoundError",
)<{
  message: string;
  environmentId: EnvironmentId;
}>() {
  constructor(args: { environmentId: EnvironmentId }) {
    super({
      environmentId: args.environmentId,
      message: `environment ${args.environmentId} is not an environment of this project`,
    });
  }
}

export async function resolveNewResourceEnvironment(
  projectId: ProjectId,
  requested?: EnvironmentId | null,
): Promise<Result<EnvironmentId | null, ResourceEnvironmentNotFoundError>> {
  if (requested) {
    const [owned] = await db
      .select({ id: environment.id })
      .from(environment)
      .where(and(eq(environment.id, requested), eq(environment.projectId, projectId)))
      .limit(1);
    return owned
      ? Result.ok(owned.id)
      : Result.err(new ResourceEnvironmentNotFoundError({ environmentId: requested }));
  }
  const [row] = await db
    .select({ environmentId: project.environmentId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  return Result.ok(row?.environmentId ?? null);
}
