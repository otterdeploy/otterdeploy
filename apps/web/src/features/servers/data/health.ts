import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Latest health snapshot per server (server.health) — written by the local
 * 60s sampler and, on swarm, the per-node health agents. 30s poll: half the
 * sample cadence keeps the rows fresh without hammering an endpoint whose
 * data only changes once a minute. docs/designs/server-health-agent.md
 */
export type ServerHealthEntry = Awaited<ReturnType<typeof orpc.server.health.call>>[number];

export const serverHealthCollection = createCollection(
  queryCollectionOptions({
    ...orpc.server.health.queryOptions(),
    queryKey: orpc.server.health.queryKey(),
    queryFn: async () => orpc.server.health.call(),
    refetchInterval: 30_000,
    queryClient,
    getKey: (entry) => entry.serverId,
  }),
);
