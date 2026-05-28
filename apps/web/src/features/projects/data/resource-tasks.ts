import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import type { Id, ID_PREFIX } from "@otterdeploy/shared/id";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Swarm task history for one resource (postgres database, service replica
 * fan-out, etc.). Backed by project.resource.tasks which dispatches on
 * resource kind to derive the right swarm service name.
 *
 * 5s `refetchInterval` so restarts + replica cycles surface live. Reads
 * are synchronous from the local store between fetches — the Deployments
 * tab doesn't flash a loading state on tab switches.
 *
 * @note Memoize with useMemo([projectId, resourceId]) at the call site.
 */
export function createResourceTasksCollection(
  projectId: Id<typeof ID_PREFIX.project>,
  resourceId: Id<typeof ID_PREFIX.resource>,
) {
  return createCollection(
    queryCollectionOptions({
      ...orpc.project.resource.tasks.queryOptions({
        input: { projectId, resourceId },
      }),
      queryKey: orpc.project.resource.tasks.queryKey({
        input: { projectId, resourceId },
      }),
      queryFn: async () =>
        orpc.project.resource.tasks.call({ projectId, resourceId }),
      refetchInterval: 5000,
      queryClient,
      getKey: (t) => t.id,
    }),
  );
}
