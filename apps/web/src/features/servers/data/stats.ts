import type { Collection } from "@tanstack/db";

import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Per-server allocation aggregates for the servers page rows. The
 * server.stats endpoint returns both perServer + cluster. This collection
 * keys on the perServer slice; the sibling clusterCollection below shares
 * the same query so opening the page fires one network call.
 *
 * 5s `refetchInterval` matches the graph cadence for swarm-stat polling.
 * Sync reads keep tab switches + sort/filter interactions instant.
 */
const STATS_QUERY_KEY = orpc.server.stats.queryKey();

type StatsView = Awaited<ReturnType<typeof orpc.server.stats.call>>;
type NodeStatsRow = StatsView["perServer"][number];
type ClusterStatsRow = StatsView["cluster"];

const serverNodeStatsQueryOptions = queryCollectionOptions({
  // Stable id: keys the persisted SQLite table (see projectCollection).
  id: "server-stats",
  ...orpc.server.stats.queryOptions(),
  queryKey: STATS_QUERY_KEY,
  queryFn: async () => orpc.server.stats.call(),
  refetchInterval: 5000,
  queryClient,
  // Widened key type keeps both createCollection branches at the same TKey.
  // Collection is invariant in it, so the annotation below needs an exact match.
  getKey: (s): string | number => s.serverId,
  select: (full: StatsView) => full.perServer,
});

// Two-branch createCollection with pinned generics: see projectCollection
// (features/projects/data/project.ts) for why the ternary can't be inlined.
// The explicit annotation collapses the two branches' differing Collection
// instantiations so `useLiveQuery(() => collection)` can infer the row type.
export const serverNodeStatsCollection: Collection<NodeStatsRow, string | number> = persistence
  ? createCollection(
      persistedCollectionOptions<NodeStatsRow, string | number>({
        ...serverNodeStatsQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(serverNodeStatsQueryOptions);

/**
 * Cluster aggregate (tasks running, project pill counts). Single-row
 * collection keyed by a constant so the same useLiveQuery pattern works
 * for the singleton.
 */
const serverClusterStatsQueryOptions = queryCollectionOptions({
  // Distinct stable id from the perServer collection above: same query,
  // different persisted table.
  id: "server-stats-cluster",
  ...orpc.server.stats.queryOptions(),
  queryKey: STATS_QUERY_KEY,
  queryFn: async () => orpc.server.stats.call(),
  refetchInterval: 5000,
  queryClient,
  getKey: (): string | number => "cluster",
  select: (full: StatsView) => [full.cluster],
});

export const serverClusterStatsCollection: Collection<ClusterStatsRow, string | number> =
  persistence
    ? createCollection(
        persistedCollectionOptions<ClusterStatsRow, string | number>({
          ...serverClusterStatsQueryOptions,
          persistence,
          schemaVersion: 1,
        }),
      )
    : createCollection(serverClusterStatsQueryOptions);
