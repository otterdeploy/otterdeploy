import { setTimeout as sleep } from "node:timers/promises";
import { Docker } from "@otterdeploy/docker";
import { createError, log } from "evlog";
import { ensureProjectNetwork } from "./client";

export type SwarmServiceRuntime = {
  serviceId: string | null;
  serviceName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
};

export type SwarmServicePort = {
  containerPort: number;
  protocol: "tcp" | "udp";
  appProtocol: "http" | "tcp";
};

export type SwarmServiceHealthcheck = {
  cmd: string[];
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  startPeriodMs: number;
};

export type SwarmServiceResources = {
  cpuLimit?: number | null;
  memoryLimitMb?: number | null;
  cpuReservation?: number | null;
  memoryReservationMb?: number | null;
};

export type SwarmServiceRestart = {
  condition: "none" | "on-failure" | "any";
  maxAttempts?: number | null;
  delayMs: number;
};

export type SwarmServiceSpec = {
  resourceId: string;
  resourceName: string;
  projectSlug: string;
  serviceName: string;
  internalHostname: string;

  image: string;
  command?: string[] | null;       // CMD
  entrypoint?: string[] | null;    // ENTRYPOINT
  env: Record<string, string>;

  replicas: number;
  restart: SwarmServiceRestart;
  healthcheck?: SwarmServiceHealthcheck | null;
  resources?: SwarmServiceResources;
  ports: SwarmServicePort[];

  forceUpdateCounter: number;
};

// ---------------------------------------------------------------------------
// Provision (idempotent on serviceName)
// ---------------------------------------------------------------------------

export async function provisionSwarmService(
  spec: SwarmServiceSpec,
): Promise<SwarmServiceRuntime> {
  const docker = Docker.fromEnv();

  const networkName = await ensureProjectNetwork(spec.projectSlug);

  const existing = await inspectSwarmService(docker, spec.serviceName, networkName);
  if (existing) {
    docker.destroy();
    return existing;
  }

  const createResult = await docker.services.create(buildServiceSpec(spec, networkName));

  if (createResult.isErr()) {
    docker.destroy();
    throw createResult.error;
  }

  const runtime = await waitForServiceReady(docker, spec.serviceName, networkName);
  docker.destroy();
  return runtime;
}

// ---------------------------------------------------------------------------
// Update (applies a new spec to an existing service)
// ---------------------------------------------------------------------------

export async function updateSwarmService(
  spec: SwarmServiceSpec,
): Promise<SwarmServiceRuntime> {
  const docker = Docker.fromEnv();

  const networkName = await ensureProjectNetwork(spec.projectSlug);
  const existing = await inspectSwarmService(docker, spec.serviceName, networkName);
  if (!existing) {
    // Not yet provisioned — fall through to provision path.
    docker.destroy();
    return provisionSwarmService(spec);
  }

  const inspectResult = await docker.services.getService(existing.serviceId ?? "").inspect();
  if (inspectResult.isErr()) {
    docker.destroy();
    throw inspectResult.error;
  }

  const currentVersion = inspectResult.value.Version?.Index;
  if (currentVersion === undefined) {
    docker.destroy();
    throw createError({
      message: "Swarm service has no Version; cannot update",
      status: 500,
      why: "Docker Swarm did not return a Version index for the existing service",
    });
  }

  const newSpec = buildServiceSpec(spec, networkName);
  const updateResult = await docker.services
    .getService(existing.serviceId ?? "")
    .update({
      version: currentVersion,
      Name: newSpec.Name,
      Labels: newSpec.Labels,
      TaskTemplate: newSpec.TaskTemplate,
      Mode: newSpec.Mode,
      EndpointSpec: newSpec.EndpointSpec,
    });

  if (updateResult.isErr()) {
    docker.destroy();
    throw updateResult.error;
  }

  const runtime = await waitForServiceReady(docker, spec.serviceName, networkName);
  docker.destroy();
  return runtime;
}

// ---------------------------------------------------------------------------
// Restart (forces task replacement with current spec — caller has bumped
// `forceUpdateCounter` so the swarm sees a meaningful diff in ForceUpdate.)
// ---------------------------------------------------------------------------

export async function restartSwarmService(
  spec: SwarmServiceSpec,
): Promise<SwarmServiceRuntime> {
  return updateSwarmService(spec);
}

// ---------------------------------------------------------------------------
// Inspect
// ---------------------------------------------------------------------------

export async function inspectSwarmServiceRuntime(input: {
  serviceName: string;
  projectSlug: string;
}): Promise<SwarmServiceRuntime> {
  const docker = Docker.fromEnv();
  const networkName = await ensureProjectNetwork(input.projectSlug);
  const runtime = await inspectSwarmService(docker, input.serviceName, networkName);
  docker.destroy();

  if (!runtime) {
    return {
      serviceId: null,
      serviceName: input.serviceName,
      networkName,
      status: "missing",
      health: null,
    };
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// Destroy
// ---------------------------------------------------------------------------

export async function destroySwarmService(input: {
  serviceName: string;
}): Promise<void> {
  const docker = Docker.fromEnv();

  const listResult = await docker.services.list({
    filters: { name: [input.serviceName] },
  });

  if (listResult.isErr()) {
    docker.destroy();
    throw listResult.error;
  }

  const service = listResult.value.find((s) => s.Spec?.Name === input.serviceName);
  if (!service || !service.ID) {
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

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildServiceSpec(spec: SwarmServiceSpec, networkName: string) {
  const envArray = Object.entries(spec.env).map(([k, v]) => `${k}=${v}`);

  const containerSpec: Record<string, unknown> = {
    Image: spec.image,
    Env: envArray,
    Hostname: spec.internalHostname,
  };

  // Docker spec: ContainerSpec.Command = ENTRYPOINT, ContainerSpec.Args = CMD.
  if (spec.entrypoint && spec.entrypoint.length > 0) {
    containerSpec.Command = spec.entrypoint;
  }
  if (spec.command && spec.command.length > 0) {
    containerSpec.Args = spec.command;
  }

  if (spec.healthcheck) {
    containerSpec.Healthcheck = {
      Test: ["CMD", ...spec.healthcheck.cmd],
      Interval: msToNs(spec.healthcheck.intervalMs),
      Timeout: msToNs(spec.healthcheck.timeoutMs),
      Retries: spec.healthcheck.retries,
      StartPeriod: msToNs(spec.healthcheck.startPeriodMs),
    };
  }

  const taskTemplate: Record<string, unknown> = {
    ContainerSpec: containerSpec,
    Networks: [
      {
        Target: networkName,
        Aliases: [spec.serviceName, spec.internalHostname, spec.resourceName],
      },
    ],
    RestartPolicy: {
      Condition: spec.restart.condition,
      MaxAttempts: spec.restart.maxAttempts ?? undefined,
      Delay: msToNs(spec.restart.delayMs),
    },
    ForceUpdate: spec.forceUpdateCounter,
  };

  if (spec.resources) {
    const limits: Record<string, number> = {};
    const reservations: Record<string, number> = {};
    if (spec.resources.cpuLimit != null) limits.NanoCPUs = cpuToNanoCpus(spec.resources.cpuLimit);
    if (spec.resources.memoryLimitMb != null) limits.MemoryBytes = mbToBytes(spec.resources.memoryLimitMb);
    if (spec.resources.cpuReservation != null) reservations.NanoCPUs = cpuToNanoCpus(spec.resources.cpuReservation);
    if (spec.resources.memoryReservationMb != null)
      reservations.MemoryBytes = mbToBytes(spec.resources.memoryReservationMb);

    const resources: Record<string, unknown> = {};
    if (Object.keys(limits).length > 0) resources.Limits = limits;
    if (Object.keys(reservations).length > 0) resources.Reservations = reservations;
    if (Object.keys(resources).length > 0) taskTemplate.Resources = resources;
  }

  const publishedPorts = spec.ports
    .filter((p) => p.appProtocol === "tcp")
    .map((p) => ({
      Protocol: p.protocol,
      TargetPort: p.containerPort,
      PublishMode: "ingress",
    }));

  return {
    Name: spec.serviceName,
    Labels: {
      "otterstack.managed": "true",
      "otterstack.resource.type": "service",
      "otterstack.project": spec.projectSlug,
      "otterstack.resource.id": spec.resourceId,
    },
    TaskTemplate: taskTemplate,
    Mode: { Replicated: { Replicas: spec.replicas } },
    EndpointSpec: publishedPorts.length > 0 ? { Ports: publishedPorts } : undefined,
  };
}

async function inspectSwarmService(
  docker: Docker,
  serviceName: string,
  networkName: string,
): Promise<SwarmServiceRuntime | null> {
  const listResult = await docker.services.list({
    filters: { name: [serviceName] },
  });

  if (listResult.isErr()) {
    throw listResult.error;
  }

  const service = listResult.value.find((s) => s.Spec?.Name === serviceName);
  if (!service) return null;

  const tasksResult = await docker.tasks.list({
    filters: { service: [serviceName] },
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
  return {
    serviceId: service.ID ?? null,
    serviceName,
    networkName,
    status: mapTaskStateToStatus(taskState),
    health: mapTaskHealth(latestTask),
  };
}

function mapTaskStateToStatus(
  state: string | undefined,
): SwarmServiceRuntime["status"] {
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
  task: { Status?: { State?: string } } | undefined,
): SwarmServiceRuntime["health"] {
  if (!task) return null;
  const state = task.Status?.State;
  if (state === "running") return "healthy";
  if (state === "starting" || state === "preparing") return "starting";
  return null;
}

async function waitForServiceReady(
  docker: Docker,
  serviceName: string,
  networkName: string,
): Promise<SwarmServiceRuntime> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const runtime = await inspectSwarmService(docker, serviceName, networkName);
    if (runtime && (runtime.status === "running" || runtime.status === "error")) {
      return runtime;
    }
    await sleep(1000);
  }

  const runtime = await inspectSwarmService(docker, serviceName, networkName);
  return (
    runtime ?? {
      serviceId: null,
      serviceName,
      networkName,
      status: "error",
      health: null,
    }
  );
}

function msToNs(ms: number): number {
  return ms * 1_000_000;
}

function cpuToNanoCpus(cores: number): number {
  return Math.round(cores * 1e9);
}

function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}
