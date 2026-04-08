import { Docker, DockerNotFoundError } from "@otterdeploy/docker";
import { PLATFORM } from "../constants";

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

export async function ensureOverlayNetwork(): Promise<void> {
  const docker = Docker.fromEnv();

  const inspectResult = await docker.networks.inspect(PLATFORM.swarm.resourceNetwork);

  if (inspectResult.isOk()) {
    const network = inspectResult.value;

    if (network.Driver === "overlay") {
      docker.destroy();
      return;
    }

    // Existing network is not overlay (e.g. bridge from pre-Swarm setup).
    // Disconnect all endpoints, then remove and recreate as overlay.
    console.log(
      "[swarm] removing non-overlay network '%s' (driver=%s)",
      PLATFORM.swarm.resourceNetwork,
      network.Driver,
    );

    const containers = network.Containers ?? {};
    for (const containerId of Object.keys(containers)) {
      console.log("[swarm] disconnecting container '%s' from network", containers[containerId]?.Name ?? containerId);
      const disconnectResult = await docker.networks
        .getNetwork(PLATFORM.swarm.resourceNetwork)
        .disconnect({ Container: containerId, Force: true });
      if (disconnectResult.isErr()) {
        console.log("[swarm] warning: failed to disconnect container: %s", disconnectResult.error.message);
      }
    }

    const removeResult = await docker.networks.getNetwork(PLATFORM.swarm.resourceNetwork).remove();
    if (removeResult.isErr()) {
      docker.destroy();
      throw removeResult.error;
    }
  } else if (!(inspectResult.error instanceof DockerNotFoundError)) {
    docker.destroy();
    throw inspectResult.error;
  }

  const createResult = await docker.networks.create({
    Name: PLATFORM.swarm.resourceNetwork,
    Driver: "overlay",
    Attachable: true,
    Labels: {
      "otterstack.managed": "true",
    },
  });
  docker.destroy();

  if (createResult.isErr()) {
    throw createResult.error;
  }
}

export async function initializeSwarm(): Promise<void> {
  await ensureSwarm();
  await ensureOverlayNetwork();
}
