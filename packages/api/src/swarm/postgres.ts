import { setTimeout as sleep } from "node:timers/promises";
import { Docker } from "@otterdeploy/docker";
import { log } from "evlog";
import { PLATFORM } from "../constants";
import { ensureProjectNetwork } from "./client";

export type SwarmPostgresRuntime = {
  serviceId: string | null;
  serviceName: string;
  volumeName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
};

type ProvisionSwarmPostgresInput = {
  serviceName: string;
  volumeName: string;
  hostnameAlias: string;
  databaseName: string;
  username: string;
  password: string;
  projectSlug: string;
};

export async function provisionSwarmPostgres(
  input: ProvisionSwarmPostgresInput,
): Promise<SwarmPostgresRuntime> {
  const docker = Docker.fromEnv();

  const networkName = await ensureProjectNetwork(input.projectSlug);

  const existing = await inspectSwarmService(docker, input.serviceName, networkName);
  if (existing) {
    docker.destroy();
    return existing;
  }

  const createResult = await docker.services.create({
    Name: input.serviceName,
    Labels: {
      "otterstack.managed": "true",
      "otterstack.resource.type": "postgres",
      "otterstack.project": input.projectSlug,
    },
    TaskTemplate: {
      ContainerSpec: {
        Image: PLATFORM.docker.postgresImage,
        Env: [
          `POSTGRES_DB=${input.databaseName}`,
          `POSTGRES_USER=${input.username}`,
          `POSTGRES_PASSWORD=${input.password}`,
        ],
        Mounts: [
          {
            Type: "volume",
            Source: input.volumeName,
            Target: "/var/lib/postgresql/data",
          },
        ],
        Healthcheck: {
          Test: ["CMD-SHELL", `pg_isready -U ${input.username} -d ${input.databaseName}`],
          Interval: 5_000_000_000,
          Timeout: 3_000_000_000,
          Retries: 20,
        },
        Hostname: input.hostnameAlias,
      },
      Networks: [
        {
          Target: networkName,
          Aliases: [input.serviceName, input.hostnameAlias],
        },
      ],
      RestartPolicy: {
        Condition: "on-failure",
        MaxAttempts: 5,
        Delay: 5_000_000_000,
      },
    },
    Mode: {
      Replicated: {
        Replicas: 1,
      },
    },
    EndpointSpec: {
      Ports: [
        {
          Protocol: "tcp",
          TargetPort: 5432,
          PublishMode: "host",
        },
      ],
    },
  });

  if (createResult.isErr()) {
    docker.destroy();
    throw createResult.error;
  }

  const runtime = await waitForServiceReady(docker, input.serviceName, networkName);
  docker.destroy();
  return runtime;
}

export async function inspectSwarmPostgresRuntime(input: {
  serviceName: string;
  volumeName: string;
  projectSlug: string;
}): Promise<SwarmPostgresRuntime> {
  const docker = Docker.fromEnv();
  const networkName = `${PLATFORM.swarm.networkPrefix}${input.projectSlug}`;

  const runtime = await inspectSwarmService(docker, input.serviceName, networkName);
  docker.destroy();

  if (!runtime) {
    return {
      serviceId: null,
      serviceName: input.serviceName,
      volumeName: input.volumeName,
      networkName,
      status: "missing",
      health: null,
    };
  }

  return runtime;
}

export async function destroySwarmPostgres(input: {
  serviceName: string;
}): Promise<void> {
  const docker = Docker.fromEnv();

  const listResult = await docker.services.list({
    filters: JSON.stringify({ name: [input.serviceName] }) as unknown as Record<string, string[]>,
  });

  if (listResult.isErr()) {
    docker.destroy();
    throw listResult.error;
  }

  const service = listResult.value.find((s) => s.Spec?.Name === input.serviceName);
  if (!service) {
    docker.destroy();
    return;
  }

  log.info({ swarm: { step: "remove-service", service: input.serviceName } });
  const removeResult = await docker.services.getService(service.ID).remove();
  docker.destroy();

  if (removeResult.isErr()) {
    throw removeResult.error;
  }
}

async function inspectSwarmService(
  docker: Docker,
  serviceName: string,
  networkName: string,
): Promise<SwarmPostgresRuntime | null> {
  const listResult = await docker.services.list({
    filters: JSON.stringify({ name: [serviceName] }) as unknown as Record<string, string[]>,
  });

  if (listResult.isErr()) {
    throw listResult.error;
  }

  const service = listResult.value.find((s) => s.Spec?.Name === serviceName);
  if (!service) {
    return null;
  }

  const tasksResult = await docker.tasks.list({
    filters: JSON.stringify({ service: [serviceName] }) as unknown as Record<string, string[]>,
  });

  if (tasksResult.isErr()) {
    throw tasksResult.error;
  }

  const latestTask = tasksResult.value
    .sort((a, b) => {
      const aTime = new Date(a.CreatedAt ?? 0).getTime();
      const bTime = new Date(b.CreatedAt ?? 0).getTime();
      return bTime - aTime;
    })
    .at(0);

  const taskState = latestTask?.Status?.State;
  const status = mapTaskStateToStatus(taskState);
  const health = mapTaskHealth(latestTask);

  return {
    serviceId: service.ID,
    serviceName,
    volumeName: service.Spec?.TaskTemplate?.ContainerSpec?.Mounts?.[0]?.Source ?? "",
    networkName,
    status,
    health,
  };
}

function mapTaskStateToStatus(
  state: string | undefined,
): SwarmPostgresRuntime["status"] {
  switch (state) {
    case "running":
      return "running";
    case "starting":
    case "preparing":
    case "assigned":
    case "accepted":
    case "ready":
    case "pending":
    case "new":
      return "starting";
    case "complete":
    case "shutdown":
      return "stopped";
    case "failed":
    case "rejected":
    case "orphaned":
    case "remove":
      return "error";
    default:
      return "missing";
  }
}

function mapTaskHealth(
  task: { Status?: { ContainerStatus?: { ContainerID?: string } }; Spec?: unknown } | undefined,
): SwarmPostgresRuntime["health"] {
  if (!task) return null;
  const state = (task as { Status?: { State?: string } }).Status?.State;
  if (state === "running") return "healthy";
  if (state === "starting" || state === "preparing") return "starting";
  return null;
}

async function waitForServiceReady(
  docker: Docker,
  serviceName: string,
  networkName: string,
): Promise<SwarmPostgresRuntime> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const runtime = await inspectSwarmService(docker, serviceName, networkName);

    if (runtime && runtime.status === "running") {
      return runtime;
    }

    if (runtime && runtime.status === "error") {
      return runtime;
    }

    await sleep(1000);
  }

  const runtime = await inspectSwarmService(docker, serviceName, networkName);
  return runtime ?? {
    serviceId: null,
    serviceName,
    volumeName: "",
    networkName,
    status: "error",
    health: null,
  };
}
