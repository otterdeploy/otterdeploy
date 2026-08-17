/**
 * Environment scoping for live queries over the shared `resourceCollection`.
 *
 * The NULL-means-main rule (a NULL `environment_id` belongs to the project's
 * MAIN environment — server: `inEnvironmentScope` in
 * packages/api/src/routers/project/queries/resource.ts) is applied at the
 * COLLECTION BOUNDARY: the resource collection's queryFn stamps NULL rows
 * with the environment they were fetched under, so every row in the client
 * store carries a concrete environment id and this helper stays a plain
 * `eq`.
 *
 * It used to return `or(eq(…), isNull(…))` for main instead — which was
 * correct row-filtering but UNPARSEABLE by the on-demand subset extractor
 * (`extractSimpleComparisons does not support 'or'`): the collection could
 * never derive a loadable subset from any query that used it, so nothing
 * network-synced. The SQLite persistence wrapper swallowed that throw into a
 * console.warn, which is how the graph silently served stale rows for days
 * (see the 2026-08-17 incident bead).
 */
import { eq, type isNull } from "@tanstack/db";

import type { ActiveEnvironment } from "./use-active-environment";

/** What the operators accept for the row's `environmentId` field.
 *  @tanstack/db does not export its `ExpressionLike` operand type, so borrow
 *  it from `isNull`'s parameter. */
type EnvironmentIdRef = Parameters<typeof isNull>[0];

export function inActiveEnvironment(
  environmentId: EnvironmentIdRef,
  activeEnv: Pick<ActiveEnvironment, "id" | "isMain">,
) {
  // Before the switcher resolves, `id` is null and the sentinel matches no
  // row — a brief empty render, then the resolved environment's subset
  // loads. The collection's subset parser treats the "" sentinel as
  // "no environment filter".
  return eq(environmentId, activeEnv.id ?? "");
}
