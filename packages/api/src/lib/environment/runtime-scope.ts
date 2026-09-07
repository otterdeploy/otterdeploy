/**
 * Which runtime scope a stored resource deploys under.
 *
 * `./scoping` defines what the suffixes ARE; this decides which one a given
 * row gets, which is the piece that was missing. `environmentScope()` had no
 * callers at all: every deploy passed a preview scope or nothing, so a service
 * in staging built the exact same container name, DNS alias and host label as
 * the one in production: two workloads racing for one identity, with whichever
 * reconciled last winning.
 *
 * Returns BASE (empty suffix) for the main environment and for unstamped rows,
 * so every already-running container keeps the name it has. Only a NON-main
 * environment takes a suffix, which is why turning this on cannot rename
 * anything currently deployed.
 */
import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, project } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";

import { BASE, environmentScope, type Scope } from "./scoping";

/**
 * The scope for a resource row, by its environment.
 *
 * A preview always wins over the environment when both apply. A preview is
 * already bound to exactly one environment, and stacking both suffixes would
 * produce `web-staging-pr-7`, a name nothing else derives or looks up.
 */
export async function resolveRuntimeScope(row: {
  projectId: ProjectId;
  environmentId: EnvironmentId | null;
}): Promise<Scope> {
  // Unstamped rows predate scoping and belong to main, which renders as base.
  if (!row.environmentId) return BASE;

  const [projectRow] = await db
    .select({ environmentId: project.environmentId })
    .from(project)
    .where(eq(project.id, row.projectId))
    .limit(1);

  // Main renders as base. See ./scoping's module note. This is the branch that
  // keeps every existing production container's name byte-identical.
  if (!projectRow || projectRow.environmentId === row.environmentId) return BASE;

  const [envRow] = await db
    .select({ slug: environment.slug })
    .from(environment)
    .where(eq(environment.id, row.environmentId))
    .limit(1);

  // A dangling environment_id must not silently deploy as production: without
  // a slug there is no suffix to build, and returning BASE here would collide
  // with main. Refuse instead.
  if (!envRow) {
    throw new Error(
      `Resource references environment ${row.environmentId}, which no longer exists. Cannot derive a runtime name.`,
    );
  }

  return environmentScope({ slug: envRow.slug, isMain: false });
}

/**
 * Scopes for EVERY environment in one project, in two queries.
 *
 * `resolveRuntimeScope` costs two queries per row, which is fine for a deploy
 * and wrong for a listing: the graph's task poll reads every service in a
 * project on every tick. This resolves the whole project once and hands back a
 * lookup.
 *
 * Same rules as the single-row version, so the two cannot drift: main and
 * unstamped both render as base. The one difference is a dangling
 * environment_id, which returns BASE here instead of throwing. A listing must
 * still render when one row is broken, and the worst case is a task not
 * matching its service (a visibly empty replicas tray) rather than a deploy
 * silently landing on production's name.
 */
export async function resolveRuntimeScopesForProject(
  projectId: ProjectId,
): Promise<(environmentId: EnvironmentId | null) => Scope> {
  const [[projectRow], envRows] = await Promise.all([
    db
      .select({ environmentId: project.environmentId })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1),
    db
      .select({ id: environment.id, slug: environment.slug })
      .from(environment)
      .where(eq(environment.projectId, projectId)),
  ]);

  const mainId = projectRow?.environmentId ?? null;
  const slugById = new Map(envRows.map((row) => [row.id, row.slug]));

  return (environmentId) => scopeForEnvironment(environmentId, mainId, slugById);
}

/**
 * The rule the batch lookup applies, extracted so it can be pinned without a
 * database. Mirrors `resolveRuntimeScope`'s branches exactly, except for the
 * dangling id (see that function's note).
 */
export function scopeForEnvironment(
  environmentId: EnvironmentId | null,
  mainEnvironmentId: EnvironmentId | null,
  slugById: ReadonlyMap<EnvironmentId, string>,
): Scope {
  if (!environmentId || environmentId === mainEnvironmentId) return BASE;
  const slug = slugById.get(environmentId);
  if (!slug) return BASE;
  return environmentScope({ slug, isMain: false });
}
