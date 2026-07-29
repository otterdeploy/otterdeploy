/**
 * Which runtime scope a stored resource deploys under.
 *
 * `./scoping` defines what the suffixes ARE; this decides which one a given
 * row gets, which is the piece that was missing. `environmentScope()` had no
 * callers at all: every deploy passed a preview scope or nothing, so a service
 * in staging built the exact same container name, DNS alias and host label as
 * the one in production — two workloads racing for one identity, with whichever
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
 * A preview always wins over the environment when both apply — a preview is
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

  // Main renders as base — see ./scoping's module note. This is the branch that
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
      `Resource references environment ${row.environmentId}, which no longer exists — cannot derive a runtime name.`,
    );
  }

  return environmentScope({ slug: envRow.slug, isMain: false });
}
