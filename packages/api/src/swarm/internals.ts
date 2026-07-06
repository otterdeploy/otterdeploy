/**
 * Internal helpers for the swarm service driver (see `./service.ts`): the
 * docker service-spec builder, service inspection, task-state mapping, and the
 * readiness poll. Split out of `./service.ts` so that file stays focused on the
 * exported provision/update/inspect/destroy orchestration.
 */

import { Docker } from "@otterdeploy/docker";
import { setTimeout as sleep } from "node:timers/promises";

import type { SwarmServiceResources, SwarmServiceRuntime, SwarmServiceSpec } from "./service";

function msToNs(ms: number): number {
  return ms * 1_000_000;
}

// A container that exits immediately on boot (e.g. a missing required env var)
// would otherwise restart forever: with `MaxAttempts` unset, swarm's default is
// UNLIMITED. Bound it so a crash-loop gives up instead of hammering the host —
// after this many failures WITHIN the window, swarm stops restarting and the
// deployment settles (surfaced as `crashing` by the deployments read). A user
// who explicitly sets maxAttempts still wins. Mirrors the database driver's cap.
const DEFAULT_MAX_RESTART_ATTEMPTS = 5;
// Evaluate the cap over a rolling window, not the task's whole lifetime, so a
// service that fails only occasionally keeps recovering — only a tight loop
// (5 failures inside 90s) trips it.
const RESTART_WINDOW_MS = 90_000;

function cpuToNanoCpus(cores: number): number {
  return Math.round(cores * 1e9);
}

function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

function buildContainerSpec(
  spec: SwarmServiceSpec,
  labels: Record<string, string>,
): Record<string, unknown> {
  const containerSpec: Record<string, unknown> = {
    Image: spec.image,
    Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
    Hostname: spec.internalHostname,
    Labels: labels,
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

  // Mounts come pre-materialized from the caller — file-type mounts had
  // their content written to disk in materializeServiceMounts(), and the
  // SpecMount entries here all reference real paths or volume names.
  if (spec.mounts.length > 0) {
    containerSpec.Mounts = spec.mounts;
  }

  return containerSpec;
}

function buildTaskResources(resources: SwarmServiceResources): Record<string, unknown> | undefined {
  const limits: Record<string, number> = {};
  const reservations: Record<string, number> = {};
  if (resources.cpuLimit != null) limits.NanoCPUs = cpuToNanoCpus(resources.cpuLimit);
  if (resources.memoryLimitMb != null) limits.MemoryBytes = mbToBytes(resources.memoryLimitMb);
  if (resources.cpuReservation != null) {
    reservations.NanoCPUs = cpuToNanoCpus(resources.cpuReservation);
  }
  if (resources.memoryReservationMb != null) {
    reservations.MemoryBytes = mbToBytes(resources.memoryReservationMb);
  }

  const out: Record<string, unknown> = {};
  if (Object.keys(limits).length > 0) out.Limits = limits;
  if (Object.keys(reservations).length > 0) out.Reservations = reservations;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildServiceSpec(spec: SwarmServiceSpec, networkName: string) {
  // Identity labels mirror onto BOTH the service spec (so `docker service ls`
  // filters work) AND the container spec (so they propagate to each live task —
  // the deployments query buckets tasks back to their deployment via the
  // `otterdeploy.deployment.id` container label, and terminal targets find
  // running containers by label). The database spec does the same; services
  // previously set neither the container labels nor the deployment id, so every
  // deployment matched 0 tasks ("0/1 replica", "0 tasks"). deployment.id is
  // only included when known.
  const otterdeployLabels: Record<string, string> = {
    "otterdeploy.managed": "true",
    "otterdeploy.resource.type": "service",
    "otterdeploy.project": spec.projectSlug,
    "otterdeploy.resource.id": spec.resourceId,
    ...(spec.deploymentId ? { "otterdeploy.deployment.id": spec.deploymentId } : {}),
  };

  const taskTemplate: Record<string, unknown> = {
    ContainerSpec: buildContainerSpec(spec, otterdeployLabels),
    Networks: [
      {
        Target: networkName,
        Aliases: [spec.serviceName, spec.internalHostname, spec.resourceName],
      },
    ],
    RestartPolicy: {
      Condition: spec.restart.condition,
      MaxAttempts: spec.restart.maxAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS,
      Delay: msToNs(spec.restart.delayMs),
      Window: msToNs(RESTART_WINDOW_MS),
    },
    ForceUpdate: spec.forceUpdateCounter,
  };

  if (spec.resources) {
    const resources = buildTaskResources(spec.resources);
    if (resources) taskTemplate.Resources = resources;
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
    Labels: otterdeployLabels,
    TaskTemplate: taskTemplate,
    Mode: { Replicated: { Replicas: spec.replicas } },
    // Zero-downtime rolling update: start the new task before stopping
    // the old one, fail the deploy + auto-rollback if the new task can't
    // hold "running" for 10s. Monitor=10s is short enough that operators
    // see fast feedback on a bad spec; MaxFailureRatio=0 means any
    // failed task aborts the rollout instead of accepting partial
    // success.
    UpdateConfig: {
      Parallelism: 1,
      Delay: 0,
      Order: "start-first" as const,
      FailureAction: "rollback" as const,
      Monitor: 10_000_000_000,
      MaxFailureRatio: 0,
    },
    RollbackConfig: {
      Parallelism: 1,
      Delay: 0,
      Order: "start-first" as const,
      FailureAction: "pause" as const,
      Monitor: 10_000_000_000,
      MaxFailureRatio: 0,
    },
    EndpointSpec: publishedPorts.length > 0 ? { Ports: publishedPorts } : undefined,
  };
}

export async function inspectSwarmService(
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

function mapTaskStateToStatus(state: string | undefined): SwarmServiceRuntime["status"] {
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

export async function waitForServiceReady(
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
