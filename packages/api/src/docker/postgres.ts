import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import {
  Docker,
  DockerConflictError,
  DockerNotFoundError,
  followProgress,
  type ContainerInspect,
} from "@otterdeploy/docker";
import type { RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";
import { PLATFORM } from "../constants";

export interface DockerPostgresRuntime {
  containerName: string;
  volumeName: string;
  networkName: string;
  hostPort: number | null;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
}

interface ProvisionDockerPostgresInput {
  containerName: string;
  volumeName: string;
  hostnameAlias: string;
  databaseName: string;
  username: string;
  password: string;
}

export async function provisionDockerPostgres(
  input: ProvisionDockerPostgresInput,
): Promise<DockerPostgresRuntime> {
  const docker = Docker.fromEnv();

  try {
    await ensureImage(docker, PLATFORM.docker.postgresImage);
    await ensureNetwork(docker, PLATFORM.docker.resourceNetwork);
    await ensureVolume(docker, input.volumeName);

    const existing = await inspectContainer(docker, input.containerName);
    if (existing) {
      if (!existing.State.Running) {
         (await docker.containers.getContainer(existing.Id).start()).unwrap();
      }

      const ready = await waitForContainerReady(docker, input.containerName);
      return toRuntimeView(ready, input.volumeName, PLATFORM.docker.resourceNetwork);
    }

    const hostPort = await findAvailablePort();

    try {
      const container = (
        await docker.containers.create({
          name: input.containerName,
          Image: PLATFORM.docker.postgresImage,
          Env: [
            `POSTGRES_DB=${input.databaseName}`,
            `POSTGRES_USER=${input.username}`,
            `POSTGRES_PASSWORD=${input.password}`,
          ],
          ExposedPorts: {
            "5432/tcp": {},
          },
          HostConfig: {
            PortBindings: {
              "5432/tcp": [
                {
                  HostIp: PLATFORM.database.localHost,
                  HostPort: String(hostPort),
                },
              ],
            },
            RestartPolicy: {
              Name: "unless-stopped",
            },
            Mounts: [
              {
                Type: "volume",
                Source: input.volumeName,
                Target: "/var/lib/postgresql/data",
              },
            ],
          },
          NetworkingConfig: {
            EndpointsConfig: {
              [PLATFORM.docker.resourceNetwork]: {
                Aliases: [input.containerName, input.hostnameAlias],
              },
            },
          },
          Healthcheck: {
            Test: ["CMD-SHELL", `pg_isready -U ${input.username} -d ${input.databaseName}`],
            Interval: 5_000_000_000,
            Timeout: 3_000_000_000,
            Retries: 20,
          },
          Labels: {
            "otterdeploy.managed": "true",
            "otterdeploy.resource.type": "postgres",
          },
        })
      ).unwrap();

      (await container.start()).unwrap();
    } catch (error) {
      if (!(error instanceof DockerConflictError)) {
        throw error;
      }
    }

    const ready = await waitForContainerReady(docker, input.containerName);
    return toRuntimeView(ready, input.volumeName, PLATFORM.docker.resourceNetwork);
  } finally {
    docker.destroy();
  }
}

export async function inspectDockerPostgresRuntime(input: {
  containerName: string;
  volumeName: string;
}): Promise<DockerPostgresRuntime> {
  const docker = Docker.fromEnv();

  try {
    const inspection = await inspectContainer(docker, input.containerName);

    if (!inspection) {
      return {
        containerName: input.containerName,
        volumeName: input.volumeName,
        networkName: PLATFORM.docker.resourceNetwork,
        hostPort: null,
        status: "missing",
        health: null,
      };
    }

    return toRuntimeView(inspection, input.volumeName, PLATFORM.docker.resourceNetwork);
  } finally {
    docker.destroy();
  }
}

export async function destroyDockerPostgres(
  input: { containerName: string },
  rlog?: RequestLogger,
): Promise<void> {
  const log = asStepLogger(rlog);
  const docker = Docker.fromEnv();

  try {
    const existing = await inspectContainer(docker, input.containerName);
    if (!existing) {
      return;
    }

    if (existing.State.Running) {
      log.info({ docker: { step: "stop-container", container: input.containerName } });
      const container = docker.containers.getContainer(existing.Id);
      await container.stop();
    }

    log.info({ docker: { step: "remove-container", container: input.containerName } });
    const container = docker.containers.getContainer(existing.Id);
    await container.remove({ force: true });
  } finally {
    docker.destroy();
  }
}

function toRuntimeView(
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

async function ensureImage(docker: Docker, image: string) {
  const inspectResult = await docker.images.getImage(image).inspect();
  if (inspectResult.isOk()) {
    return;
  }

  if (!(inspectResult.error instanceof DockerNotFoundError)) {
    throw inspectResult.error;
  }

  const stream =  (await docker.pull(image)).unwrap();

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

async function ensureNetwork(docker: Docker, networkName: string) {
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

async function ensureVolume(docker: Docker, volumeName: string) {
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

async function inspectContainer(docker: Docker, containerName: string) {
  const inspectResult = await docker.containers.inspect(containerName);
  if (inspectResult.isOk()) {
    return inspectResult.value;
  }

  if (inspectResult.error instanceof DockerNotFoundError) {
    return null;
  }

  throw inspectResult.error;
}

async function waitForContainerReady(docker: Docker, containerName: string) {
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

async function findAvailablePort() {
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
