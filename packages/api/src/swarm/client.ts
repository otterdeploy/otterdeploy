import type { EndpointSettings } from "@otterdeploy/docker";
import type { RequestLogger } from "evlog";

import { Docker, DockerNotFoundError } from "@otterdeploy/docker";
import { Result } from "better-result";

import { PLATFORM } from "../constants";
import { asStepLogger } from "../lib/logger";
import { SwarmOperationError } from "./errors";
import { projectNetworkName } from "./network-name";
import { pickOverlaySubnet } from "./overlay-subnet";

export async function ensureSwarm(): Promise<void> {
  const docker = Docker.fromEnv();

  const infoResult = await docker.system.info();
  if (infoResult.isErr()) {
    docker.destroy();
    throw infoResult.error;
  }

  if (infoResult.value.Swarm?.LocalNodeState === "active") {
    docker.destroy();
    return;
  }

  const initResult = await docker.system.swarmInit({
    ListenAddr: "127.0.0.1:2377",
    AdvertiseAddr: "127.0.0.1:2377",
  });
  docker.destroy();

  if (initResult.isErr()) {
    throw initResult.error;
  }
}

/**
 * Ensure the overlay network for a project AND environment exists.
 * Network name: otterdeploy-{projectSlug}{scopeSuffix} — see ./network-name.
 * Caddy is connected to the network so it can route traffic to project services.
 *
 * `scopeSuffix` defaults to base (""), which is what the MAIN environment
 * renders as, so every already-deployed project keeps the network it has.
 */
export async function ensureProjectNetwork(
  projectSlug: string,
  scopeSuffix = "",
  rlog?: RequestLogger,
): Promise<string> {
  const log = asStepLogger(rlog);
  const networkName = projectNetworkName(projectSlug, scopeSuffix);
  const docker = Docker.fromEnv();

  const inspectResult = await docker.networks.inspect(networkName);

  if (inspectResult.isOk()) {
    const network = inspectResult.value;

    if (network.Driver === "overlay") {
      await connectCaddyToNetwork(docker, networkName, rlog);
      docker.destroy();
      return networkName;
    }

    // Non-overlay network exists (e.g. bridge from pre-Swarm setup). Replace it.
    log.info({
      swarm: { step: "remove-non-overlay-network", network: networkName, driver: network.Driver },
    });

    const containers = network.Containers ?? {};
    for (const containerId of Object.keys(containers)) {
      log.info({
        swarm: {
          step: "disconnect-container",
          network: networkName,
          container: containers[containerId]?.Name ?? containerId,
        },
      });
      const disconnectResult = await docker.networks
        .getNetwork(networkName)
        .disconnect({ Container: containerId, Force: true });
      if (disconnectResult.isErr()) {
        log.warn({
          swarm: {
            step: "disconnect-container",
            network: networkName,
            container: containers[containerId]?.Name ?? containerId,
            error: disconnectResult.error.message,
          },
        });
      }
    }

    const removeResult = await docker.networks.getNetwork(networkName).remove();
    if (removeResult.isErr()) {
      docker.destroy();
      throw removeResult.error;
    }
  } else if (!(inspectResult.error instanceof DockerNotFoundError)) {
    docker.destroy();
    throw inspectResult.error;
  }

  // An explicit subnet, never the swarm's default pool: see ./overlay-subnet.
  const subnet = await freeOverlaySubnet(docker);
  log.info({ swarm: { step: "create-network", network: networkName, subnet } });
  const createResult = await docker.networks.create({
    Name: networkName,
    Driver: "overlay",
    Attachable: true,
    ...(subnet ? { IPAM: { Config: [{ Subnet: subnet }] } } : {}),
    Labels: {
      "otterdeploy.managed": "true",
      "otterdeploy.project": projectSlug,
    },
  });

  if (createResult.isErr()) {
    docker.destroy();
    throw createResult.error;
  }

  await connectCaddyToNetwork(docker, networkName, rlog);
  docker.destroy();
  return networkName;
}

/** A subnet no network on this daemon holds, from the overlay range; null
 *  when the daemon cannot be listed or the range is full (the swarm then
 *  allocates, as before). */
async function freeOverlaySubnet(docker: Docker): Promise<string | null> {
  const listed = await docker.networks.list();
  if (listed.isErr()) return null;
  const used = listed.value.flatMap((n) => (n.IPAM?.Config ?? []).flatMap((c) => c.Subnet ?? []));
  return pickOverlaySubnet(used);
}

/**
 * Connect the Caddy container to a network so it can route traffic.
 * No-op if already connected.
 */
// Exported so the plain-Docker runtime can attach Caddy to a project's bridge
// network too (the edge reaches containers by name on the shared network in
// both runtimes).
/**
 * Locate the platform's edge (Caddy) container. Tries the known names first,
 * then falls back to the compose service label: docker compose v2 appends a
 * `-N` replica index (`otterdeploy-caddy-1`), so exact-name inspects miss it.
 * A user-DEPLOYED caddy carries an otterdeploy.resource.id label; the edge
 * never does, which is how the two are told apart. Returns null when no edge
 * container exists (dev without the compose stack).
 */
export async function findEdgeContainerId(docker: Docker): Promise<string | null> {
  const caddyNames = [
    PLATFORM.swarm.caddyContainer,
    // Local compose names the edge container after the repo, while
    // production installs keep the otterdeploy-* name.
    "otterdeploy-caddy",
    "caddy",
  ];
  for (const caddyName of caddyNames) {
    const inspectResult = await docker.containers.inspect(caddyName);
    if (inspectResult.isOk()) return inspectResult.value.Id;
  }
  const listed = await docker.containers.list({
    all: true,
    filters: { label: ["com.docker.compose.service=caddy"] },
  });
  if (listed.isOk()) {
    const edge = listed.value.find((c) => !c.Labels["otterdeploy.resource.id"]);
    if (edge) return edge.Id;
  }
  return null;
}

export async function connectCaddyToNetwork(
  docker: Docker,
  networkName: string,
  rlog?: RequestLogger,
): Promise<void> {
  const log = asStepLogger(rlog);

  let container: {
    Id: string;
    NetworkSettings?: { Networks?: Record<string, EndpointSettings> };
  } | null = null;

  const edgeId = await findEdgeContainerId(docker);
  if (edgeId) {
    const inspected = await docker.containers.inspect(edgeId);
    if (inspected.isOk()) container = inspected.value;
  }

  if (!container) {
    // Caddy not running: skip silently, it'll connect on next provision.
    return;
  }

  const connectedNetworks = container.NetworkSettings?.Networks ?? {};

  if (networkName in connectedNetworks) {
    return;
  }

  log.info({ swarm: { step: "connect-caddy", network: networkName } });
  const connectResult = await docker.networks
    .getNetwork(networkName)
    .connect({ Container: container.Id });

  if (connectResult.isErr()) {
    log.warn({
      swarm: { step: "connect-caddy", network: networkName, error: connectResult.error.message },
    });
  }
}

/**
 * Re-attach the edge Caddy to EVERY managed project network.
 *
 * The per-project bridge networks are connected to Caddy dynamically at deploy
 * time (`ensureBridgeNetwork` → `connectCaddyToNetwork`). But a RECREATED Caddy
 * container (image update, `docker compose up -d`, the in-app updater) rejoins
 * only its compose networks and drops every dynamically-added project bridge, so
 * all deployed services 502 until something re-connects them. Running this on
 * each reconcile (incl. the server-boot reconcile) makes a Caddy restart
 * self-heal. Plain-docker only; the swarm overlay keeps the edge attached across
 * restarts. Idempotent (each connect no-ops when already attached).
 */
export async function ensureEdgeOnProjectNetworks(rlog?: RequestLogger): Promise<void> {
  const docker = Docker.fromEnv();
  const list = await docker.networks.list({ filters: { label: ["otterdeploy.managed=true"] } });
  if (list.isErr()) return;
  for (const net of list.value) {
    if (net.Name) await connectCaddyToNetwork(docker, net.Name, rlog);
  }
}

/** What happened to a project network on removal. */
export type NetworkRemoval =
  /** It existed, belonged to the project, and is gone. */
  | "removed"
  /** There was nothing to remove. */
  | "absent"
  /** A network by that name exists but another project created it: two slugs
   *  can render the same name (`web` + env `staging` vs project
   *  `web-staging`), and that one is not ours to take down. */
  | "foreign";

/**
 * Remove one of a project's overlay networks (`networkName`, as
 * `projectNetworkName` renders it for the project or one of its environments).
 *
 * Disconnects what is still attached first: the edge (Caddy) is connected to
 * every project network and holds an endpoint on it until told otherwise. A
 * network still used by a swarm service is refused by the daemon, which comes
 * back as an error to retry, never as a forced removal.
 */
export async function removeProjectNetwork(
  input: { networkName: string; projectSlug: string },
  rlog?: RequestLogger,
): Promise<Result<NetworkRemoval, SwarmOperationError>> {
  const log = asStepLogger(rlog);
  const docker = Docker.fromEnv();
  try {
    const inspectResult = await docker.networks.inspect(input.networkName);
    if (inspectResult.isErr()) {
      return inspectResult.error instanceof DockerNotFoundError
        ? Result.ok("absent")
        : Result.err(
            new SwarmOperationError({ step: "inspect-network", cause: inspectResult.error }),
          );
    }
    const network = inspectResult.value;
    if (network.Labels?.["otterdeploy.project"] !== input.projectSlug) return Result.ok("foreign");

    const handle = docker.networks.getNetwork(input.networkName);
    for (const [containerId, endpoint] of Object.entries(network.Containers ?? {})) {
      const disconnected = await handle.disconnect({ Container: containerId, Force: true });
      if (disconnected.isErr()) {
        log.warn({
          swarm: {
            step: "disconnect-container",
            network: input.networkName,
            container: endpoint.Name ?? containerId,
            error: disconnected.error.message,
          },
        });
      }
    }

    const removeResult = await handle.remove();
    if (removeResult.isErr()) {
      return removeResult.error instanceof DockerNotFoundError
        ? Result.ok("absent")
        : Result.err(
            new SwarmOperationError({ step: "remove-network", cause: removeResult.error }),
          );
    }
    log.info({ swarm: { step: "remove-network", network: input.networkName } });
    return Result.ok("removed");
  } finally {
    docker.destroy();
  }
}

export async function initializeSwarm(): Promise<void> {
  await ensureSwarm();
}
