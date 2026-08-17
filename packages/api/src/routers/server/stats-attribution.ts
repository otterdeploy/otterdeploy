/**
 * Two attribution rules the stats aggregation depends on, split out of ./stats
 * to keep that file under the line cap.
 *
 * Both exist because a count that is merely *plausible* is worse than no count:
 * the servers table is where an operator decides whether a node is carrying
 * work, and it was confidently wrong in two different ways.
 */

import type { Node, Task } from "@otterdeploy/docker";

/**
 * Swarm nodes the manager cannot currently reach.
 *
 * A task's `Status.State` is the manager's LAST OBSERVED state. Once a node
 * stops reporting, its tasks keep claiming `running` indefinitely, so a node
 * displayed as "down" sat there advertising live tasks it could not possibly
 * still be running.
 */
export function unreachableNodeIds(nodes: readonly Node[]): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.ID && (n.Status?.State ?? "").toLowerCase() !== "ready") out.add(n.ID);
  }
  return out;
}

/** Running AND on a node reachable enough to confirm it. */
export function isLiveTask(task: Task, unreachable: ReadonlySet<string>): boolean {
  if ((task.Status?.State ?? "") !== "running") return false;
  return !(task.NodeID && unreachable.has(task.NodeID));
}

/**
 * Which row owns the plain-docker container count.
 *
 * Plain docker is single-node: every managed container runs on the machine the
 * control plane is on. The count used to go to `servers[0]`, which assumed that
 * row WAS the local host. True only while an org had exactly one server. Add a
 * second and the total landed on whichever row the query returned first, so a
 * remote worker running nothing displayed the manager's containers.
 *
 * Falls back to the first row when no local row is identifiable, which keeps a
 * total visible rather than silently dropping it.
 */
export function localHostRowIndex(
  servers: readonly { name: string | null; host?: string | null; role?: string | null }[],
): number {
  const local = servers.findIndex(
    (s) => s.role === "manager" && (s.host === "127.0.0.1" || s.name === "localhost"),
  );
  return local >= 0 ? local : 0;
}
