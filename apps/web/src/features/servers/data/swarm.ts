import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Live swarm topology (server.swarmNodes) — manager reachability, leadership
 * and per-node role feed the "Managers & quorum" card, the leader marker in
 * the node table, and the role/removal actions in the health sheet.
 *
 * Single-row collection keyed by a constant (same idiom as
 * serverClusterStatsCollection): the payload's `swarm` flag matters as much
 * as the node list, so the whole view travels together. 10s poll —
 * leadership/reachability move slower than task placement (5s) but a quorum
 * pane lying for a minute would be worse than the extra request.
 */
export type SwarmNodesView = Awaited<ReturnType<typeof orpc.server.swarmNodes.call>>;
export type SwarmNode = SwarmNodesView["nodes"][number];

export const swarmNodesCollection = createCollection(
  queryCollectionOptions({
    ...orpc.server.swarmNodes.queryOptions(),
    queryKey: orpc.server.swarmNodes.queryKey(),
    queryFn: async () => orpc.server.swarmNodes.call(),
    refetchInterval: 10_000,
    queryClient,
    getKey: () => "swarm",
    select: (full: SwarmNodesView) => [full],
  }),
);

/** Refresh the topology after a confirmed promote/demote/remove — don't wait
 *  out the 10s poll to show the new quorum truth. */
export function refetchSwarmNodes(): void {
  void queryClient.invalidateQueries({ queryKey: orpc.server.swarmNodes.queryKey() });
}
