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
    docker.destroy();
    return;
  }

  if (!(inspectResult.error instanceof DockerNotFoundError)) {
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
