import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * All resources (databases + services + …) for the active project. Sourced
 * from `project.resource.list` which returns a discriminated union over
 * `type`. The collection is per-project — caller supplies `projectId`.
 */
export function createResourceCollection(projectId: string) {
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
