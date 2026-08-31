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
 * Returns null only for a project with no `environment_id` pointer at all,
 * which `project.create` has always set.
 *
 * Deliberately a leaf: it imports the db, the schema and ids and nothing else,
 * so the three routers that call it cannot gain an import cycle from doing so.
 */
import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";

export async function newResourceEnvironmentId(
  projectId: ProjectId,
  requested?: EnvironmentId | null,
): Promise<EnvironmentId | null> {
  if (requested) return requested;
  const [row] = await db
    .select({ environmentId: project.environmentId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  return row?.environmentId ?? null;
}
