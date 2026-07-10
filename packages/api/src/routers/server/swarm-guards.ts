/**
 * Pure quorum/topology guards for swarm role + membership mutations.
 * Split from role.ts / remove-node.ts so the refusal logic is unit-testable
 * without the docker client or the db (same idiom as node-match.ts).
 */

import type { Node } from "@otterdeploy/docker";

/**
 * Raft majority: how many managers must be reachable for the cluster to
 * accept writes. floor(m/2)+1 — 1 of 1, 2 of 2 (a 2-manager cluster
 * tolerates zero failures), 2 of 3, 3 of 5.
 */
export function quorumRequired(managerCount: number): number {
  return Math.floor(Math.max(0, managerCount) / 2) + 1;
}

export function isManagerNode(node: Node): boolean {
  return node.Spec?.Role === "manager";
}

export type DemotionBlock = "last-manager" | "leader";

/**
 * Why demoting `target` must be refused, or null when it's safe.
 *
 * - `last-manager`: a swarm with zero managers is bricked — no node can
 *   accept management commands to ever promote one back.
 * - `leader`: docker refuses to demote the current Raft leader anyway;
 *   catching it here gives the operator a clear 409 instead of a raw
 *   daemon error, and tells them to promote another manager first.
 *
 * Demoting a node that is already a worker is a no-op (null): role.ts
 * short-circuits before calling docker.
 */
export function assessDemotion(nodes: Node[], target: Node): DemotionBlock | null {
  if (!isManagerNode(target)) return null;
  const managers = nodes.filter(isManagerNode);
  if (managers.length <= 1) return "last-manager";
  if (target.ManagerStatus?.Leader === true) return "leader";
  return null;
}

/**
 * Only nodes the swarm already reports as `down` may be removed. Removing a
 * live node requires `--force` and orphans its tasks — deliberately not
 * exposed; the honest path is drain → demote (if manager) → stop the daemon
 * on the host → remove once the swarm marks it down.
 */
export function canRemoveFromSwarm(node: Node): boolean {
  return node.Status?.State === "down";
}
