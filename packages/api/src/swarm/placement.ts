/**
 * Pin a service's tasks to one swarm node.
 *
 * `TaskTemplate.Placement.Constraints` is the only thing that decides where a
 * task may run; without it the scheduler is free to put a service anywhere,
 * which is correct for stateless work and wrong for anything holding a local
 * volume.
 *
 * Constrain on node ID, never hostname. Hostnames are not unique in practice —
 * re-provisioning a machine leaves the old node registered under the same
 * hostname alongside the new one, and a hostname constraint would then match
 * both, including the dead one.
 *
 * What pinning costs, spelled out because the UI has to say it: a pinned
 * service does NOT fail over. If its node dies, swarm leaves the task pending
 * rather than moving it — which is the only safe behaviour when the service's
 * data lives on that node's disk, and the wrong one for a stateless replica.
 */

/** A swarm node id, as it appears in `docker node ls`. */
export type SwarmNodeId = string;

/**
 * Swarm rejects a malformed constraint outright, taking the whole deploy with
 * it. Node ids are opaque alphanumerics, so anything else is a bug upstream
 * (a hostname, a server row id, an empty string) and is dropped rather than
 * emitted — an unplaced service beats a service that can't be created at all.
 */
export function isSwarmNodeId(value: unknown): value is SwarmNodeId {
  return typeof value === "string" && /^[a-z0-9]{5,}$/i.test(value);
}

/**
 * The `Placement` fragment for a service spec, or null when the service is
 * unpinned. Null means "omit the key entirely" — an empty Constraints array is
 * not the same thing to swarm.
 */
export function placementFor(nodeId: unknown): { Constraints: string[] } | null {
  if (!isSwarmNodeId(nodeId)) return null;
  return { Constraints: [`node.id == ${nodeId}`] };
}

/**
 * Merge placement into a TaskTemplate, leaving it untouched when unpinned.
 * Written as a spread rather than a mutation so callers can keep building
 * specs as plain literals.
 */
export function withPlacement<T extends object>(
  taskTemplate: T,
  nodeId: unknown,
): T & { Placement?: { Constraints: string[] } } {
  const placement = placementFor(nodeId);
  return placement ? { ...taskTemplate, Placement: placement } : taskTemplate;
}

/**
 * Spread-ready placement: `{ Placement }` when pinned, `{}` when not. Lets a
 * spec literal stay a literal instead of branching around one key.
 */
export function placementSpread(nodeId: unknown): { Placement?: { Constraints: string[] } } {
  const placement = placementFor(nodeId);
  return placement ? { Placement: placement } : {};
}
