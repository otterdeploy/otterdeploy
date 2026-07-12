/**
 * Pure helpers for resolving + updating the swarm node behind a server row.
 * Split from availability.ts so they can be unit-tested without importing
 * the docker client or the db (type-only imports erase at runtime).
 */

import type { Node, NodeUpdateOptions } from "@otterdeploy/docker";

export type NodeAvailability = "active" | "drain" | "pause";

/**
 * Resolve the swarm node backing a server row. Matches the swarm-reported
 * hostname against the row's OS hostname first, then the friendly name
 * (the bootstrap row is named "localhost" while its real OS hostname lives
 * in `hostname` — same candidate order as the stats aggregation).
 */
export function matchSwarmNode(
  nodes: Node[],
  server: { hostname: string | null; name: string | null },
): Node | undefined {
  const candidates = [server.hostname, server.name].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  for (const candidate of candidates) {
    const node = nodes.find((n) => n.Description?.Hostname === candidate);
    if (node) return node;
  }
  return undefined;
}

/**
 * Build the node-update payload. Docker's node update REPLACES the whole
 * NodeSpec, so the current Name/Labels/Role must be carried over or they'd
 * be cleared; `version` is the optimistic-concurrency token from inspect.
 */
export function buildAvailabilityUpdate(
  node: Node,
  availability: NodeAvailability,
): NodeUpdateOptions {
  return {
    version: node.Version?.Index ?? 0,
    ...(node.Spec?.Name !== undefined ? { Name: node.Spec.Name } : {}),
    ...(node.Spec?.Labels !== undefined ? { Labels: node.Spec.Labels } : {}),
    ...(node.Spec?.Role !== undefined ? { Role: node.Spec.Role } : {}),
    Availability: availability,
  };
}

export type NodeRole = "manager" | "worker";

/**
 * Build the promote/demote payload — same full-NodeSpec carry-over as
 * buildAvailabilityUpdate (docker REPLACES the whole spec), so the role flip
 * keeps the node's availability and labels intact.
 */
export function buildRoleUpdate(node: Node, role: NodeRole): NodeUpdateOptions {
  return {
    version: node.Version?.Index ?? 0,
    ...(node.Spec?.Name !== undefined ? { Name: node.Spec.Name } : {}),
    ...(node.Spec?.Labels !== undefined ? { Labels: node.Spec.Labels } : {}),
    ...(node.Spec?.Availability !== undefined ? { Availability: node.Spec.Availability } : {}),
    Role: role,
  };
}
