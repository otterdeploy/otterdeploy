import { Docker, DockerNotFoundError } from "@otterdeploy/docker";
import { PLATFORM } from "../constants";

export async function ensureSwarm(): Promise<void> {
  const docker = Docker.fromEnv();

  try {
    const info = (await docker.system.info()).unwrap();
    if (info.Swarm?.LocalNodeState === "active") {
      return;
    }

    await docker.system.swarmInit({
      ListenAddr: "127.0.0.1:2377",
      AdvertiseAddr: "127.0.0.1:2377",
    });
  } finally {
    docker.destroy();
  }
}

export async function ensureOverlayNetwork(): Promise<void> {
  const docker = Docker.fromEnv();

  try {
    const inspectResult = await docker.networks.inspect(PLATFORM.swarm.resourceNetwork);
    if (inspectResult.isOk()) {
      return;
    }

    if (!(inspectResult.error instanceof DockerNotFoundError)) {
      throw inspectResult.error;
    }

    await (
      await docker.networks.create({
        Name: PLATFORM.swarm.resourceNetwork,
        Driver: "overlay",
        Attachable: true,
        Labels: {
          "otterstack.managed": "true",
        },
      })
    ).unwrap();
  } finally {
    docker.destroy();
  }
}

export async function initializeSwarm(): Promise<void> {
  await ensureSwarm();
  await ensureOverlayNetwork();
}
