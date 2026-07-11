/**
 * Live swarm topology for the servers page — the "Managers & quorum" card
 * and the leader marker in the node table. One `docker node ls` per call,
 * no caching: reachability/leadership are exactly what quorum questions are
 * about, so stale answers would be worse than none.
 *
 * Enriches each node with the org's matching server-row id (same
 * hostname-based join as availability.ts / stats.ts) so the UI can wire
 * promote/demote/remove actions — which take a ServerId — straight from a
 * node row. `serverId: null` = the node joined the swarm but was never
 * registered as a server; actions stay disabled for it, honestly.
 *
 * Plain-docker runtime: `{ swarm: false, nodes: [] }` — the UI renders its
 * "requires Docker Swarm" state instead of an empty cluster.
 */

import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";

import { isSwarmRuntime } from "../../runtime";
import { SwarmNodeListError } from "./errors";
import { matchSwarmNode, type NodeRole } from "./node-match";
import { listServersByOrg } from "./queries";

export interface SwarmNodeEntry {
  /** Swarm node id. */
  id: string;
  hostname: string;
  role: NodeRole;
  availability: string;
  /** Node status.state — "ready", "down", … */
  state: string;
  addr: string | null;
  leader: boolean;
  /** ManagerStatus.Reachability — "reachable"/"unreachable"/"unknown"; null on workers. */
  reachability: string | null;
  engineVersion: string | null;
  /** Matching registered server row, or null when the node isn't registered. */
  serverId: ServerId | null;
}

export interface SwarmNodesView {
  swarm: boolean;
  nodes: SwarmNodeEntry[];
}

/** ManagerStatus-derived fields — workers carry none. */
function managerInfo(ms: { Leader?: boolean; Reachability?: string } | null | undefined): {
  leader: boolean;
  reachability: string | null;
} {
  return { leader: ms?.Leader ?? false, reachability: ms?.Reachability ?? null };
}

/** Node address: Status.Addr, falling back to the manager address. */
function nodeAddr(
  status: { Addr?: string } | null | undefined,
  ms: { Addr?: string } | null | undefined,
): string | null {
  return status?.Addr ?? ms?.Addr ?? null;
}

function engineVersionOf(
  description: { Engine?: { EngineVersion?: string } } | undefined,
): string | null {
  return description?.Engine?.EngineVersion ?? null;
}

export async function listSwarmNodes(input: {
  organizationId: OrganizationId;
}): Promise<Result<SwarmNodesView, SwarmNodeListError>> {
  if (!isSwarmRuntime()) {
    return Result.ok({ swarm: false, nodes: [] });
  }

  const servers = await listServersByOrg(input.organizationId);

  const docker = Docker.fromEnv();
  try {
    const nodesResult = await docker.nodes.list({});
    if (nodesResult.isErr()) {
      return Result.err(new SwarmNodeListError({ cause: nodesResult.error.message }));
    }
    const nodes = nodesResult.value;

    // Reverse the row→node join: each row claims its node (first match wins),
    // then every node looks up which row claimed it.
    const serverIdByNodeId = new Map<string, ServerId>();
    for (const server of servers) {
      const node = matchSwarmNode(nodes, server);
      if (node?.ID && !serverIdByNodeId.has(node.ID)) {
        serverIdByNodeId.set(node.ID, server.id);
      }
    }

    return Result.ok({
      swarm: true,
      nodes: nodes.map(
        (n): SwarmNodeEntry => ({
          id: n.ID ?? "",
          hostname: n.Description?.Hostname ?? n.ID ?? "",
          role: n.Spec?.Role === "manager" ? ("manager" as const) : ("worker" as const),
          availability: n.Spec?.Availability ?? "active",
          state: n.Status?.State ?? "unknown",
          addr: nodeAddr(n.Status, n.ManagerStatus),
          ...managerInfo(n.ManagerStatus),
          engineVersion: engineVersionOf(n.Description),
          serverId: serverIdByNodeId.get(n.ID ?? "") ?? null,
        }),
      ),
    });
  } finally {
    docker.destroy();
  }
}
