import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import type { Id, ID_PREFIX } from "@otterdeploy/shared/id";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Deployment history for one resource. Each row is one logical push to
 * swarm — see packages/api/src/routers/project/deployments.ts.
 *
 * 5s refetchInterval: status is derived from underlying tasks every time
 * we list, so we need to poll to catch state transitions on running tasks.
 */
export function createDeploymentsCollection(
  projectId: Id<typeof ID_PREFIX.project>,
  resourceId: Id<typeof ID_PREFIX.resource>,
) {
  return createCollection(
    queryCollectionOptions({
      ...orpc.project.resource.deployments.list.queryOptions({
        input: { projectId, resourceId },
      }),
      queryKey: orpc.project.resource.deployments.list.queryKey({
        input: { projectId, resourceId },
      }),
      queryFn: async () =>
        orpc.project.resource.deployments.list.call({ projectId, resourceId }),
      refetchInterval: 5000,
      queryClient,
      getKey: (d) => d.id,
    }),
  );
}
