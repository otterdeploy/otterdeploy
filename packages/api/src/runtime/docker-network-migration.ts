import type { Docker } from "@otterdeploy/docker";

import { connectCaddyToNetwork } from "../swarm/client";
import { projectNetworkName } from "../swarm/network-name";

/** Slugs contain no dots, so project and scope cannot concatenate ambiguously.
 * Main keeps its installed name; additional scopes have a distinct boundary. */
export function dockerNetworkName(projectSlug: string, scopeSuffix = ""): string {
  return projectNetworkName(projectSlug, scopeSuffix ? `.${scopeSuffix.slice(1)}` : "");
}

/** Re-home an existing container without recreating it or changing its DNS names.
 * Attach first; a failed attach leaves the existing workload reachable. A failed
 * detach is an error, never a successful claim of isolation. Retried on boot.
 */
export async function moveToScopedNetwork(
  docker: Docker,
  containerId: string,
  projectSlug: string,
  target: string,
  aliases: string[] = [],
): Promise<void> {
  const inspected = await docker.containers.inspect(containerId);
  if (inspected.isErr()) throw inspected.error;
  const networks = inspected.value.NetworkSettings?.Networks ?? {};
  const legacy = projectNetworkName(projectSlug);
  if (target === legacy) return;
  if (!networks[target]) {
    const names = [...new Set([...aliases, ...(networks[legacy]?.Aliases ?? [])])];
    const attached = await docker.networks.getNetwork(target).connect({
      Container: containerId,
      EndpointConfig: { Aliases: names },
    });
    if (attached.isErr()) throw attached.error;
  }
  if (networks[legacy]) {
    const detached = await docker.networks
      .getNetwork(legacy)
      .disconnect({ Container: containerId, Force: true });
    if (detached.isErr()) throw detached.error;
  }
}

/** Ensure the project's user-defined bridge network exists (idempotent). On a
 *  single-node host this replaces the swarm overlay: containers on it resolve
 *  each other by name/alias. */
export async function ensureBridgeNetwork(
  docker: Docker,
  projectSlug: string,
  scopeSuffix = "",
): Promise<string> {
  const name = dockerNetworkName(projectSlug, scopeSuffix);
  const list = await docker.networks.list({ filters: { name: [name] } });
  if (!(list.isOk() && list.value.some((n) => n.Name === name))) {
    const created = await docker.networks.create({
      Name: name,
      Driver: "bridge",
      Attachable: true,
      Labels: { "otterdeploy.managed": "true", "otterdeploy.project": projectSlug },
    });
    // A racing create can 409 if another deploy just made it. Only re-throw if
    // it's genuinely still missing after the race.
    if (created.isErr()) {
      const recheck = await docker.networks.list({ filters: { name: [name] } });
      if (!(recheck.isOk() && recheck.value.some((n) => n.Name === name))) {
        throw created.error;
      }
    }
  }
  // Attach the edge so exposed services are reachable by container name. The
  // plain-Docker equivalent of the overlay path's caddy-connect.
  await connectCaddyToNetwork(docker, name);
  return name;
}
