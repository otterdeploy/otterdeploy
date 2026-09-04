/**
 * Internal helpers for the swarm service driver (see `./service.ts`): the
 * docker service-spec builder, service inspection, task-state mapping, and the
 * readiness poll. Split out of `./service.ts` so that file stays focused on the
 * exported provision/update/inspect/destroy orchestration.
 */

import { Docker } from "@otterdeploy/docker";
import { omitUndefined } from "@otterdeploy/shared/object";
import { setTimeout as sleep } from "node:timers/promises";

import type { SwarmServiceResources, SwarmServiceRuntime, SwarmServiceSpec } from "./service";
import type {
  SwarmContainerSpec,
  SwarmResourceObject,
  SwarmTaskResources,
  SwarmTaskTemplate,
} from "./spec-types";

import { resolveExtraNetworkTargets } from "./extra-networks";
import { placementSpread } from "./placement";
import { byCreatedDesc, mapTaskHealth, resolveTaskStatus } from "./task-status";

// Task-state mapping moved to ./task-status.ts (line cap); re-exported so
// existing importers (the status tests) keep their path.
export { resolveTaskStatus } from "./task-status";

function msToNs(ms: number): number {
  return ms * 1_000_000;
}

// Docker healthcheck Test markers: when a stored cmd already leads with one,
// the array is a complete Test value and must pass through verbatim. Anything
// else is treated as a bare exec-form command and gets the historical "CMD"
// prefix, so pre-existing rows keep working unchanged.
const HEALTHCHECK_TEST_MARKERS = new Set(["CMD", "CMD-SHELL", "NONE"]);

/**
 * Map a stored healthcheck cmd to Docker's `Healthcheck.Test` array. Shared by
 * the swarm driver and the plain-Docker driver (both previously hardcoded the
 * "CMD" prefix, which broke any `["CMD-SHELL", …]` shell one-liner: the form
 * the HTTP health-check UI writes).
 */
export function toHealthcheckTest(cmd: string[]): string[] {
  const marker = cmd[0];
  if (marker !== undefined && HEALTHCHECK_TEST_MARKERS.has(marker)) return [...cmd];
  return ["CMD", ...cmd];
}

// A container that exits immediately on boot (e.g. a missing required env var)
// would otherwise restart forever: with `MaxAttempts` unset, swarm's default is
// UNLIMITED. Bound it so a crash-loop gives up instead of hammering the host.
// After this many failures WITHIN the window, swarm stops restarting and the
// deployment settles (surfaced as `crashing` by the deployments read). A user
// who explicitly sets maxAttempts still wins. Mirrors the database driver's cap.
const DEFAULT_MAX_RESTART_ATTEMPTS = 5;
// Evaluate the cap over a rolling window, not the task's whole lifetime, so a
// service that fails only occasionally keeps recovering, only a tight loop
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
): SwarmContainerSpec {
  const containerSpec: SwarmContainerSpec = {
    Image: spec.image,
    Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
    // UTS hostname is `sethostname`-capped at 64 bytes; the internal FQDN can
    // exceed that for long names and crash runc. Use the ≤63-char service name.
    // Discovery uses the network aliases (which keep the FQDN), not this.
    Hostname: spec.serviceName,
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
      Test: toHealthcheckTest(spec.healthcheck.cmd),
      Interval: msToNs(spec.healthcheck.intervalMs),
      Timeout: msToNs(spec.healthcheck.timeoutMs),
      Retries: spec.healthcheck.retries,
      StartPeriod: msToNs(spec.healthcheck.startPeriodMs),
    };
  }

  // Mounts come pre-materialized from the caller. File-type mounts had
  // their content written to disk in materializeServiceMounts(), and the
  // SpecMount entries here all reference real paths or volume names.
  if (spec.mounts.length > 0) {
    containerSpec.Mounts = spec.mounts;
  }

  return containerSpec;
}

function buildTaskResources(resources: SwarmServiceResources): SwarmTaskResources | undefined {
  const limits: SwarmResourceObject = {};
  const reservations: SwarmResourceObject = {};
  if (resources.cpuLimit != null) limits.NanoCPUs = cpuToNanoCpus(resources.cpuLimit);
  if (resources.memoryLimitMb != null) limits.MemoryBytes = mbToBytes(resources.memoryLimitMb);
  if (resources.cpuReservation != null) {
    reservations.NanoCPUs = cpuToNanoCpus(resources.cpuReservation);
  }
  if (resources.memoryReservationMb != null) {
    reservations.MemoryBytes = mbToBytes(resources.memoryReservationMb);
  }

  const out: SwarmTaskResources = {};
  if (Object.keys(limits).length > 0) out.Limits = limits;
  if (Object.keys(reservations).length > 0) out.Reservations = reservations;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildServiceSpec(spec: SwarmServiceSpec, networkName: string) {
  // Identity labels mirror onto BOTH the service spec (so `docker service ls`
  // filters work) AND the container spec (so they propagate to each live task.
  // The deployments query buckets tasks back to their deployment via the
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

  const taskTemplate: SwarmTaskTemplate = {
    ContainerSpec: buildContainerSpec(spec, otterdeployLabels),
    // Project network first: it carries the service's DNS aliases and Caddy
    // routing, so it is unconditional. Extras join alias-less (cross-network
    // reachability, not discovery identity); dedupe + project-name skip live
    // in resolveExtraNetworkTargets so the rule is unit-testable.
    Networks: [
      {
        Target: networkName,
        Aliases: [spec.serviceName, spec.internalHostname, spec.resourceName],
      },
      ...resolveExtraNetworkTargets(spec.extraNetworks, networkName).map((name) => ({
        Target: name,
        Aliases: [],
      })),
    ],
    RestartPolicy: {
      Condition: spec.restart.condition,
      MaxAttempts: spec.restart.maxAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS,
      Delay: msToNs(spec.restart.delayMs),
      Window: msToNs(RESTART_WINDOW_MS),
    },
    ForceUpdate: spec.forceUpdateCounter,
    ...placementSpread(spec.placementNodeId),
  };

  if (spec.resources) {
    const resources = buildTaskResources(spec.resources);
    if (resources) taskTemplate.Resources = resources;
  }

  // Omitting `PublishedPort` makes swarm assign one from the ingress range
  // (30000-32767). For a TCP port that is harmless: the edge reaches it over
  // the overlay by service name, so the host port is never the address anyone
  // uses (see caddy/layer4.ts, which emits `proxy <serviceName>:<port>`).
  //
  // UDP has no such path. Caddy's layer4 proxy is TCP, and the HTTP edge
  // obviously is too, so for UDP the published HOST port IS the address
  // clients dial. Letting swarm pick it at random meant every UDP port the
  // platform has ever published landed somewhere unpredictable, with nothing
  // in the UI naming it — declared, bound, billed for, and unreachable.
  // NetBird's STUN (3478/udp) and LiveKit's media (7882/udp) both die this
  // way: the client is told to talk to 3478 and nothing is listening there.
  //
  // Pinning it to the container port is what `ports: ["3478/udp"]` plainly
  // means to an operator. Two stacks claiming the same UDP port now collide
  // and the second deploy fails loudly, which is the honest outcome: one host
  // port cannot serve two services, and failing beats both being silently
  // unreachable.
  const publishedPorts = spec.ports
    .filter((p) => p.appProtocol === "tcp")
    .map((p) =>
      omitUndefined({
        Protocol: p.protocol,
        TargetPort: p.containerPort,
        PublishedPort: p.protocol === "udp" ? p.containerPort : undefined,
        PublishMode: "ingress" as const,
      }),
    );

  return {
    Name: spec.serviceName,
    Labels: otterdeployLabels,
    TaskTemplate: taskTemplate,
    Mode: { Replicated: { Replicas: spec.replicas } },
    // Start-first rolling update: start the new task before stopping the old
    // one, then fail + auto-rollback if it cannot hold `running` for 10s.
    // Avoiding interrupted requests still depends on enough spare capacity
    // and an application healthcheck; Swarm's running state alone does not
    // prove readiness. MaxFailureRatio=0 rejects partial rollout failure.
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

  const latestTask = tasksResult.value.toSorted(byCreatedDesc).at(0);
  const { status, errorMessage } = resolveTaskStatus(tasksResult.value);

  return {
    serviceId: service.ID ?? null,
    serviceName,
    networkName,
    status,
    health: mapTaskHealth(latestTask),
    errorMessage,
  };
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
      errorMessage: "swarm service not found after deploy",
    }
  );
}
