/**
 * The runtime this install deploys with (DEPLOY_RUNTIME on the server), read
 * off the `swarm` flag `server.swarmNodes` already carries: the server derives
 * it from the same `isSwarmRuntime()` check, and the endpoint is org-scoped, so
 * any member gets the same answer. Copy that names the runtime reads it here
 * instead of assuming Swarm: the installer default is plain Docker.
 *
 * Pure (no collection import) so the copy can be tested without a store.
 */

export type DeployRuntime = "swarm" | "docker";

/** `null` until the first read lands: say nothing rather than guess. */
export function deployRuntime(view: { swarm: boolean } | null | undefined): DeployRuntime | null {
  if (!view) return null;
  return view.swarm ? "swarm" : "docker";
}

/** The Servers page subtitle, per runtime (pluralised by `count`). */
export function serversDescriptionKey(
  runtime: DeployRuntime | null,
): "servers.nodeDescription" | "servers.nodeDescriptionDocker" | "servers.nodeDescriptionPending" {
  if (runtime === "swarm") return "servers.nodeDescription";
  if (runtime === "docker") return "servers.nodeDescriptionDocker";
  return "servers.nodeDescriptionPending";
}

/** How a new service gets started, for the wizard's apply note. Plain Docker
 *  runs exactly one container per service (the driver ignores replicas above
 *  one), so it never promises replicas. */
export function deployPhrase(replicas: number, runtime: DeployRuntime | null): string {
  if (runtime === "swarm")
    return `deploy ${replicas} replica${replicas > 1 ? "s" : ""} via Docker Swarm`;
  if (runtime === "docker")
    return replicas > 1
      ? "run it as one Docker container (this install runs plain Docker, which runs one container per service)"
      : "run it as a Docker container";
  return "start it";
}
