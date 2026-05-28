import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import type { Id, ID_PREFIX } from "@otterdeploy/shared/id";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Live tasks for every service in a project, keyed by resourceId. Backed by
 * project.serviceTasks (one docker.tasks.list filtered by all serviceNames).
 * The graph view uses this to populate each service node's REPLICAS tray.
 *
 * 5s `refetchInterval` matches the graph's polling cadence so the live
 * replica state stays current as the swarm converges. Sync reads keep
 * graph re-mounts (e.g. after closing the detail panel) instant.
 *
 * @note Memoize with useMemo([projectId]) at the call site.
 */
export function createServiceTasksCollection(
  projectId: Id<typeof ID_PREFIX.project>,
) {
  return createCollection(
    queryCollectionOptions({
      ...orpc.project.serviceTasks.queryOptions({ input: { projectId } }),
      queryKey: orpc.project.serviceTasks.queryKey({ input: { projectId } }),
      queryFn: async () => orpc.project.serviceTasks.call({ projectId }),
      refetchInterval: 5000,
      queryClient,
      getKey: (entry) => entry.resourceId,
    }),
  );
}
