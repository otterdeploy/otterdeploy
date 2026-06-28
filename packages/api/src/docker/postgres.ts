import type { RequestLogger } from "evlog";

import { Docker, DockerConflictError } from "@otterdeploy/docker";

import { PLATFORM } from "../constants";
import { asStepLogger } from "../lib/logger";
import {
  ensureImage,
  ensureNetwork,
  ensureVolume,
  findAvailablePort,
  inspectContainer,
  toRuntimeView,
  waitForContainerReady,
} from "./postgres-helpers";

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
