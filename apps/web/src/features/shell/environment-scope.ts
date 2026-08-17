/**
 * Client-side twin of the server's `inEnvironmentScope`
 * (packages/api/src/routers/project/queries/resource.ts): a NULL
 * `environment_id` means the project's MAIN environment. Main owns every
 * unstamped row; a non-main environment owns only what explicitly names it.
 *
 * Every live query that scopes the shared `resourceCollection` by environment
 * filters through this so the vocabulary stays in one place. The predicate is
 * deliberately a SINGLE simple comparison: the resource collection normalizes
 * NULL-stamped rows to the project's main-environment id at ingest
 * (features/resources/data/resource.ts), so `isNull` never has anything to
 * match, and an `or(...)` here would crash the OPFS persistence subset parser
 * (`extractSimpleComparisons` in @tanstack/query-db-collection only handles
 * simple comparisons — an `or` where-clause threw SyncCleanupError in
 * production, od-lqm). If the ingest normalization ever moves, this helper is
 * the one place to revisit.
 */
import { eq, isNull } from "@tanstack/db";

import type { ActiveEnvironment } from "./use-active-environment";

/** What the operators accept for the row's `environmentId` field.
 *  @tanstack/db does not export its `ExpressionLike` operand type, so borrow
 *  it from `isNull`'s parameter (`eq`'s own is too narrow for nullable refs). */
type EnvironmentIdRef = Parameters<typeof isNull>[0];

export function inActiveEnvironment(
  environmentId: EnvironmentIdRef,
  activeEnv: Pick<ActiveEnvironment, "id" | "isMain">,
) {
  return eq(environmentId, activeEnv.id ?? "");
}
