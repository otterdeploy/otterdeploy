/**
 * Resolve a server row to the swarm node id a placement constraint can use.
 *
 * The existing `matchSwarmNode` takes the FIRST hostname match, which is fine
 * for the topology table but wrong here. Hostnames are not unique: re-provision
 * a machine and the swarm keeps the old node registered under the same
 * hostname, Down, alongside the new one. This cluster is in exactly that state.
 * Two nodes named `ubuntu-4gb-nbg1-1`, one Ready and one Down. First-match
 * would happily pin a service to the dead one, and swarm would accept the
 * constraint and leave the task pending forever with no error worth reading.
 *
 * So: prefer a node that can actually run work, and when nothing can, say so
 * rather than pinning to a corpse.
 */

import type { Node } from "@otterdeploy/docker";

/** What resolution needs from a server row. */
export interface ServerIdentity {
  hostname: string | null;
  name: string | null;
}

export type NodeResolution =
  | { kind: "resolved"; nodeId: string }
  /** Hostname matched, but every match is Down/drained. Pinning would hang. */
  | { kind: "unschedulable"; reason: string }
  /** No node carries this row's hostname at all. */
  | { kind: "unknown"; reason: string };

/** A node that can accept new tasks: reachable AND not drained/paused. */
function isSchedulable(node: Node): boolean {
  return node.Status?.State === "ready" && (node.Spec?.Availability ?? "active") === "active";
}

/**
 * Every node whose hostname matches this row, most-preferred first. Hostname
 * is checked before the friendly name because the bootstrap row is called
 * "localhost" while its real OS hostname lives in `hostname`. Same candidate
 * order as the stats aggregation, so the two agree on which node is which.
 */
function matchingNodes(nodes: readonly Node[], server: ServerIdentity): Node[] {
  const candidates = [server.hostname, server.name].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const seen = new Set<string>();
  const matches: Node[] = [];
  for (const candidate of candidates) {
    for (const node of nodes) {
      const id = node.ID;
      if (!id || seen.has(id)) continue;
      if (node.Description?.Hostname === candidate) {
        seen.add(id);
        matches.push(node);
      }
    }
  }
  return matches;
}

/**
 * Pick the node to pin to. Pure, so the collision behaviour is assertable
 * without a live daemon.
 */
export function pickNodeForServer(nodes: readonly Node[], server: ServerIdentity): NodeResolution {
  const matches = matchingNodes(nodes, server);
  if (matches.length === 0) {
    const label = server.hostname ?? server.name ?? "(unnamed)";
    return { kind: "unknown", reason: `No swarm node matches server "${label}".` };
  }

  const schedulable = matches.find(isSchedulable);
  if (schedulable?.ID) return { kind: "resolved", nodeId: schedulable.ID };

  // Every match is down or drained. Returning one anyway would produce a
  // constraint swarm accepts and can never satisfy.
  const states = matches
    .map((n) => `${n.Status?.State ?? "unknown"}/${n.Spec?.Availability ?? "active"}`)
    .join(", ");
  return {
    kind: "unschedulable",
    reason: `Server "${server.hostname ?? server.name}" matches ${matches.length} swarm node(s), none schedulable (${states}).`,
  };
}
