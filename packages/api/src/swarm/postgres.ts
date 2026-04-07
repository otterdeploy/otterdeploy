import { setTimeout as sleep } from "node:timers/promises";
import { Docker, DockerNotFoundError } from "@otterdeploy/docker";
import { PLATFORM } from "../constants";
import { ensureOverlayNetwork } from "./client";

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
};

export async function provisionSwarmPostgres(
  input: ProvisionSwarmPostgresInput,
): Promise<SwarmPostgresRuntime> {
  const docker = Docker.fromEnv();

  try {
    await ensureOverlayNetwork();

    // Check if service already exists
    const existing = await inspectSwarmService(docker, input.serviceName);
    if (existing) {
      return existing;
    }

    const response = (
      await docker.services.create({
        Name: input.serviceName,
        Labels: {
          "otterstack.managed": "true",
          "otterstack.resource.type": "postgres",
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
              Target: PLATFORM.swarm.resourceNetwork,
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
      })
    ).unwrap();

    // Wait for the service task to be running
    const runtime = await waitForServiceReady(docker, input.serviceName);
    return runtime;
  } finally {
    docker.destroy();
  }
}

export async function inspectSwarmPostgresRuntime(input: {
  serviceName: string;
  volumeName: string;
}): Promise<SwarmPostgresRuntime> {
  const docker = Docker.fromEnv();

  try {
    const runtime = await inspectSwarmService(docker, input.serviceName);
    if (!runtime) {
      return {
        serviceId: null,
        serviceName: input.serviceName,
        volumeName: input.volumeName,
        networkName: PLATFORM.swarm.resourceNetwork,
        status: "missing",
        health: null,
      };
    }

    return runtime;
  } finally {
    docker.destroy();
  }
}

export async function destroySwarmPostgres(input: {
  serviceName: string;
}): Promise<void> {
  const docker = Docker.fromEnv();

  try {
    const listResult = (await docker.services.list({
      filters: { name: [input.serviceName] },
    })).unwrap();

    const service = listResult.find((s) => s.Spec?.Name === input.serviceName);
    if (!service) {
      return;
    }

    console.log("[swarm:postgres] removing service '%s'", input.serviceName);
    await docker.services.getService(service.ID).remove();
  } finally {
    docker.destroy();
  }
}

async function inspectSwarmService(
  docker: Docker,
  serviceName: string,
): Promise<SwarmPostgresRuntime | null> {
  const listResult = (await docker.services.list({
    filters: { name: [serviceName] },
  })).unwrap();

  const service = listResult.find((s) => s.Spec?.Name === serviceName);
  if (!service) {
    return null;
  }

  // Get the latest task for this service
  const tasks = (await docker.tasks.list({
    filters: { service: [serviceName] },
  })).unwrap();

  const latestTask = tasks
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
    networkName: PLATFORM.swarm.resourceNetwork,
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
): Promise<SwarmPostgresRuntime> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const runtime = await inspectSwarmService(docker, serviceName);

    if (runtime && runtime.status === "running") {
      return runtime;
    }

    if (runtime && runtime.status === "error") {
      return runtime;
    }

    await sleep(1000);
  }

  // Timeout — return whatever state we have
  const runtime = await inspectSwarmService(docker, serviceName);
  return runtime ?? {
    serviceId: null,
    serviceName,
    volumeName: "",
    networkName: PLATFORM.swarm.resourceNetwork,
    status: "error",
    health: null,
  };
}
