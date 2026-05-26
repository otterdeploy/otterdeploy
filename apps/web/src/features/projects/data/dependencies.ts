import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import type { Id, ID_PREFIX } from "@otterstack/shared/id";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Resource dependency edges for a project, derived from variable refs in
 * service env vars (server-side via project.dependencies). One row per
 * directed edge, keyed by "source->target" so React Flow's edge id matches
 * the collection key naturally.
 *
 * @note Memoize with useMemo([projectId]) at the call site.
 */
export function createProjectDependenciesCollection(
  projectId: Id<typeof ID_PREFIX.project>,
) {
  return createCollection(
    queryCollectionOptions({
      ...orpc.project.dependencies.queryOptions({ input: { projectId } }),
      queryKey: orpc.project.dependencies.queryKey({ input: { projectId } }),
      queryFn: async () => orpc.project.dependencies.call({ projectId }),
      queryClient,
      getKey: (e) => `${e.source}->${e.target}`,
    }),
  );
}
