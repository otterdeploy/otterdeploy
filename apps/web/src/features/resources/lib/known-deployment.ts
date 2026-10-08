import type { DeploymentLifecycle } from "./resource-state";

/**
 * The latest deployment's status as far as anything on screen knows it.
 *
 * `undefined` means NOT KNOWN YET, `null` means there is none. The two used to
 * collapse into one: while the panel's deployment list was still loading it
 * read as empty, an empty list read as "never deployed", and a running service
 * opened to "not deployed" next to a graph node saying "running".
 * The graph reads `latestDeploymentStatus` off the resource
 * row, which is already loaded by the time a panel can open, so that row is
 * the fallback here: the panel starts from the graph's own answer and the live
 * list takes over once it lands.
 */
export function knownDeploymentStatus(input: {
  /** Newest row of the live deployment list, if it has one. */
  listed: { status: DeploymentLifecycle | null } | undefined;
  listLoading: boolean;
  /** The resource row's `latestDeploymentStatus` (what the graph node reads);
   *  undefined when the caller has no row (a staged create). */
  fromResource: DeploymentLifecycle | null | undefined;
}): { status: DeploymentLifecycle | null } | undefined {
  if (input.listed) return input.listed;
  if (input.fromResource !== undefined) return { status: input.fromResource };
  return input.listLoading ? undefined : { status: null };
}
