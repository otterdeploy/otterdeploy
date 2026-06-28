/**
 * Lower-level helpers for the single-node Docker Postgres driver (see
 * `./postgres.ts`): image/network/volume ensure, container inspect + readiness
 * poll, host-port allocation, and the runtime-view mapping. Split out so
 * `./postgres.ts` stays focused on the provision/inspect/destroy surface.
 */

import {
  Docker,
  DockerNotFoundError,
  followProgress,
  type ContainerInspect,
} from "@otterdeploy/docker";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import type { DockerPostgresRuntime } from "./postgres";

import { PLATFORM } from "../constants";

export function toRuntimeView(
  inspection: ContainerInspect,
  volumeName: string,
  networkName: string,
): DockerPostgresRuntime {
  const healthStatus = inspection.State.Health?.Status;
  const health =
    healthStatus === "healthy" || healthStatus === "unhealthy" || healthStatus === "starting"
      ? healthStatus
      : null;

  return {
    containerName: trimContainerName(inspection.Name),
    volumeName,
    networkName,
    hostPort: getPublishedPort(inspection),
    status: getRuntimeStatus(inspection),
    health,
  };
}

function getRuntimeStatus(inspection: ContainerInspect): DockerPostgresRuntime["status"] {
  if (inspection.State.Running) {
    if (inspection.State.Health?.Status === "starting") {
      return "starting";
    }

    return "running";
  }

  if (inspection.State.Restarting) {
    return "starting";
  }

  if (inspection.State.Error) {
    return "error";
  }

  return "stopped";
}

export async function ensureImage(docker: Docker, image: string) {
  const inspectResult = await docker.images.getImage(image).inspect();
  if (inspectResult.isOk()) {
    return;
  }

  if (!(inspectResult.error instanceof DockerNotFoundError)) {
    throw inspectResult.error;
  }

  const stream = (await docker.pull(image)).unwrap();

  await new Promise<void>((resolve, reject) => {
    followProgress(stream, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function ensureNetwork(docker: Docker, networkName: string) {
  const inspectResult = await docker.networks.inspect(networkName);
  if (inspectResult.isOk()) {
    return;
  }

  if (!(inspectResult.error instanceof DockerNotFoundError)) {
    throw inspectResult.error;
  }

  (
    await docker.networks.create({
      Name: networkName,
      Driver: "bridge",
      Attachable: true,
      Labels: {
        "otterdeploy.managed": "true",
      },
    })
  ).unwrap();
}

export async function ensureVolume(docker: Docker, volumeName: string) {
  const inspectResult = await docker.volumes.inspect(volumeName);
  if (inspectResult.isOk()) {
    return;
  }

  if (!(inspectResult.error instanceof DockerNotFoundError)) {
    throw inspectResult.error;
  }

  (
    await docker.volumes.create({
      Name: volumeName,
      Labels: {
        "otterdeploy.managed": "true",
      },
    })
  ).unwrap();
}

export async function inspectContainer(docker: Docker, containerName: string) {
  const inspectResult = await docker.containers.inspect(containerName);
  if (inspectResult.isOk()) {
    return inspectResult.value;
  }

  if (inspectResult.error instanceof DockerNotFoundError) {
    return null;
  }

  throw inspectResult.error;
}

export async function waitForContainerReady(docker: Docker, containerName: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const inspection = (await docker.containers.inspect(containerName)).unwrap();
    const health = inspection.State.Health?.Status;

    if (inspection.State.Running && (health === undefined || health === "healthy")) {
      return inspection;
    }

    if (health === "unhealthy") {
      return inspection;
    }

    await sleep(1000);
  }

  return (await docker.containers.inspect(containerName)).unwrap();
}

export async function findAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, PLATFORM.database.localHost, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate a Docker host port.")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

function getPublishedPort(inspection: ContainerInspect) {
  const binding = inspection.NetworkSettings.Ports?.["5432/tcp"]?.[0];
  if (!binding?.HostPort) {
    return null;
  }

  const value = Number(binding.HostPort);
  return Number.isFinite(value) ? value : null;
}

function trimContainerName(value: string) {
  return value.startsWith("/") ? value.slice(1) : value;
}
