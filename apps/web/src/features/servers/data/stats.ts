import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Per-server allocation aggregates for the servers page rows. The
 * server.stats endpoint returns both perServer + cluster — this collection
 * keys on the perServer slice; the sibling clusterCollection below shares
 * the same query so opening the page fires one network call.
 *
 * 5s `refetchInterval` matches the graph cadence for swarm-stat polling.
 * Sync reads keep tab switches + sort/filter interactions instant.
 */
const STATS_QUERY_KEY = orpc.server.stats.queryKey();

export const serverNodeStatsCollection = createCollection(
  queryCollectionOptions({
    ...orpc.server.stats.queryOptions(),
    queryKey: STATS_QUERY_KEY,
    queryFn: async () => orpc.server.stats.call(),
    refetchInterval: 5000,
    queryClient,
    getKey: (s) => s.serverId,
    select: (full: Awaited<ReturnType<typeof orpc.server.stats.call>>) =>
      full.perServer,
  }),
);

/**
 * Cluster aggregate (tasks running, project pill counts). Single-row
 * collection keyed by a constant so the same useLiveQuery pattern works
 * for the singleton.
 */
export const serverClusterStatsCollection = createCollection(
  queryCollectionOptions({
    ...orpc.server.stats.queryOptions(),
    queryKey: STATS_QUERY_KEY,
    queryFn: async () => orpc.server.stats.call(),
    refetchInterval: 5000,
    queryClient,
    getKey: () => "cluster",
    select: (full: Awaited<ReturnType<typeof orpc.server.stats.call>>) => [
      full.cluster,
    ],
  }),
);
