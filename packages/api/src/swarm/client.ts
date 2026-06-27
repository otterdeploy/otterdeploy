import type { RequestLogger } from "evlog";

import { Docker, DockerNotFoundError } from "@otterdeploy/docker";

import { PLATFORM } from "../constants";
import { asStepLogger } from "../lib/logger";

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
 * Ensure a per-project overlay network exists.
 * Network name: otterdeploy-{projectSlug}
 * Caddy is connected to the network so it can route traffic to project services.
 */
export async function ensureProjectNetwork(
  projectSlug: string,
  rlog?: RequestLogger,
): Promise<string> {
  const log = asStepLogger(rlog);
  const networkName = `${PLATFORM.swarm.networkPrefix}${projectSlug}`;
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

  log.info({ swarm: { step: "create-network", network: networkName } });
  const createResult = await docker.networks.create({
    Name: networkName,
    Driver: "overlay",
    Attachable: true,
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

/**
 * Connect the Caddy container to a network so it can route traffic.
 * No-op if already connected.
 */
// Exported so the plain-Docker runtime can attach Caddy to a project's bridge
// network too (the edge reaches containers by name on the shared network in
// both runtimes).
export async function connectCaddyToNetwork(
  docker: Docker,
  networkName: string,
  rlog?: RequestLogger,
): Promise<void> {
  const log = asStepLogger(rlog);
  const caddyNames = [
    PLATFORM.swarm.caddyContainer,
    // Local compose names the edge container after the repo, while
    // production installs keep the otterdeploy-* name.
    "otterdeploy-caddy",
    "caddy",
  ];

  let container: {
    Id: string;
    NetworkSettings?: { Networks?: Record<string, unknown> };
  } | null = null;

  for (const caddyName of caddyNames) {
    const inspectResult = await docker.containers.inspect(caddyName);
    if (inspectResult.isOk()) {
      container = inspectResult.value;
      break;
    }
  }

  if (!container) {
    // Caddy not running — skip silently, it'll connect on next provision.
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
 * Remove a project's overlay network.
 * Disconnects all containers first.
 */
export async function removeProjectNetwork(
  projectSlug: string,
  rlog?: RequestLogger,
): Promise<void> {
  const log = asStepLogger(rlog);
  const networkName = `${PLATFORM.swarm.networkPrefix}${projectSlug}`;
  const docker = Docker.fromEnv();

  const inspectResult = await docker.networks.inspect(networkName);
  if (inspectResult.isErr()) {
    docker.destroy();
    return;
  }

  const network = inspectResult.value;
  const containers = network.Containers ?? {};

  for (const containerId of Object.keys(containers)) {
    await docker.networks
      .getNetwork(networkName)
      .disconnect({ Container: containerId, Force: true });
  }

  const removeResult = await docker.networks.getNetwork(networkName).remove();
  docker.destroy();

  if (removeResult.isErr()) {
    log.warn({
      swarm: { step: "remove-network", network: networkName, error: removeResult.error.message },
    });
  }
}

export async function initializeSwarm(): Promise<void> {
  await ensureSwarm();
}
