import type { Collection } from "@tanstack/db";

import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { useLiveQuery } from "@tanstack/react-db";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Live swarm topology (server.swarmNodes), manager reachability, leadership
 * and per-node role feed the "Managers & quorum" card, the leader marker in
 * the node table, and the role/removal actions in the health sheet.
 *
 * Single-row collection keyed by a constant (same idiom as
 * serverClusterStatsCollection): the payload's `swarm` flag matters as much
 * as the node list, so the whole view travels together. 10s poll:
 * leadership/reachability move slower than task placement (5s) but a quorum
 * pane lying for a minute would be worse than the extra request.
 */
export type SwarmNodesView = Awaited<ReturnType<typeof orpc.server.swarmNodes.call>>;
export type SwarmNode = SwarmNodesView["nodes"][number];

const swarmNodesQueryOptions = queryCollectionOptions({
  // Stable id: keys the persisted SQLite table (see projectCollection).
  id: "swarm",
  ...orpc.server.swarmNodes.queryOptions(),
  queryKey: orpc.server.swarmNodes.queryKey(),
  queryFn: async () => orpc.server.swarmNodes.call(),
  refetchInterval: 10_000,
  queryClient,
  // Widened key type keeps both createCollection branches at the same TKey.
  // Collection is invariant in it, so the annotation below needs an exact match.
  getKey: (): string | number => "swarm",
  select: (full: SwarmNodesView) => [full],
});

// Two-branch createCollection with pinned generics: see projectCollection
// (features/projects/data/project.ts) for why the ternary can't be inlined.
// The explicit annotation collapses the two branches' differing Collection
// instantiations so `useLiveQuery(() => collection)` can infer the row type.
export const swarmNodesCollection: Collection<SwarmNodesView, string | number> = persistence
  ? createCollection(
      persistedCollectionOptions<SwarmNodesView, string | number>({
        ...swarmNodesQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(swarmNodesQueryOptions);

/** Refresh the topology after a confirmed promote/demote/remove. Don't wait
 *  out the 10s poll to show the new quorum truth. */
export function refetchSwarmNodes(): void {
  void queryClient.invalidateQueries({ queryKey: orpc.server.swarmNodes.queryKey() });
}

/**
 * Whether this install runs on Swarm, or null until the topology has loaded.
 *
 * Placement pickers render only when this is true: plain Docker starts every
 * workload on the control plane and refuses a pin to any other server, so a
 * picker there would only offer a choice that cannot be made.
 */
export function useIsSwarm(): boolean | null {
  const { data = [] } = useLiveQuery(() => swarmNodesCollection);
  return data[0]?.swarm ?? null;
}
