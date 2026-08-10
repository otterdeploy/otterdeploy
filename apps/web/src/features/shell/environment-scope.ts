/**
 * Client-side twin of the server's `inEnvironmentScope`
 * (packages/api/src/routers/project/queries/resource.ts): a NULL
 * `environment_id` means the project's MAIN environment. Main owns every
 * unstamped row; a non-main environment owns only what explicitly names it.
 *
 * Every live query that scopes the shared `resourceCollection` by environment
 * must filter through this. The strict `eq(r.environmentId, activeEnv.id)` it
 * replaces disagreed with the server: the API returned NULL-stamped rows to
 * the main environment, and the client then filtered them out of every list:
 * a deployed resource that existed, ran, and never rendered anywhere (od-lqm).
 */
import { eq, isNull, or } from "@tanstack/db";

import type { ActiveEnvironment } from "./use-active-environment";

/** What the operators accept for the row's `environmentId` field.
 *  @tanstack/db does not export its `ExpressionLike` operand type, so borrow
 *  it from `isNull`'s parameter. */
type EnvironmentIdRef = Parameters<typeof isNull>[0];

export function inActiveEnvironment(
  environmentId: EnvironmentIdRef,
  activeEnv: Pick<ActiveEnvironment, "id" | "isMain">,
) {
  const owned = eq(environmentId, activeEnv.id ?? "");
  return activeEnv.isMain ? or(owned, isNull(environmentId)) : owned;
}
