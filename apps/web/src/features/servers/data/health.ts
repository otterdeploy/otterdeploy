import type { Collection } from "@tanstack/db";

import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Latest health snapshot per server (server.health): written by the local
 * 60s sampler and, on swarm, the per-node health agents. 30s poll: half the
 * sample cadence keeps the rows fresh without hammering an endpoint whose
 * data only changes once a minute. docs/designs/server-health-agent.md
 */
export type ServerHealthEntry = Awaited<ReturnType<typeof orpc.server.health.call>>[number];

const serverHealthQueryOptions = queryCollectionOptions({
  // Stable id: keys the persisted SQLite table (see projectCollection).
  id: "server-health",
  ...orpc.server.health.queryOptions(),
  queryKey: orpc.server.health.queryKey(),
  queryFn: async () => orpc.server.health.call(),
  refetchInterval: 30_000,
  queryClient,
  // Widened key type keeps both createCollection branches at the same TKey.
  // Collection is invariant in it, so the annotation below needs an exact match.
  getKey: (entry): string | number => entry.serverId,
});

// Two-branch createCollection with pinned generics: see projectCollection
// (features/projects/data/project.ts) for why the ternary can't be inlined.
// The explicit annotation collapses the two branches' differing Collection
// instantiations so `useLiveQuery(() => collection)` can infer the row type.
export const serverHealthCollection: Collection<ServerHealthEntry, string | number> = persistence
  ? createCollection(
      persistedCollectionOptions<ServerHealthEntry, string | number>({
        ...serverHealthQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(serverHealthQueryOptions);
