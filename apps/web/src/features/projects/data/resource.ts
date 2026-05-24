import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import type { Id, ID_PREFIX } from "@otterstack/shared/id";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * All resources (databases + services + …) for the active project. Sourced
 * from `project.resource.list` which returns a discriminated union over
 * `type`. The collection is per-project — caller supplies `projectId`.
 *
 * @note Each call returns a NEW collection instance. Memoize the return value
 * (e.g. `useMemo`) when calling from a React render — otherwise the collection
 * is recreated every render and the TanStack DB subscription model breaks.
 */
export function createResourceCollection(projectId: Id<typeof ID_PREFIX.project>) {
  return createCollection(
    queryCollectionOptions({
      ...orpc.project.resource.list.queryOptions({ input: { projectId } }),
      queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
      queryFn: async () => orpc.project.resource.list.call({ projectId }),
      onDelete: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map((m) =>
            orpc.project.resource.delete.call({
              projectId,
              resourceId: m.original.resourceId,
            }),
          ),
        );
      },
      queryClient,
      getKey: (item) => item.resourceId,
    }),
  );
}
