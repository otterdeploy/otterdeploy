/**
 * Generic swarm spec / provision / update / inspect / destroy for any
 * supported database engine. All engine-specific knobs (image, env scheme,
 * healthcheck, mount path, optional --requirepass-style command) come from
 * the adapter in `./database-engines`. The orchestration code below (network
 * ensure, service create, ForceUpdate bump on update, wait-ready polling,
 * task state mapping) is engine-agnostic.
 */

import { Docker } from "@otterdeploy/docker";
import { log, type RequestLogger } from "evlog";

import {
  type DatabaseEngine,
  DATABASE_ENGINES,
} from "@otterstack/shared/database-engines";

import { asStepLogger } from "../lib/logger";
import { PLATFORM } from "../constants";
import { ensureProjectNetwork } from "./client";
import { getEngineAdapter } from "./database-engines";
import { subscribeDockerEvents } from "./events";

export interface SwarmDatabaseRuntime {
  serviceId: string | null;
  serviceName: string;
  volumeName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
}

export interface ProvisionSwarmDatabaseInput {
  engine: DatabaseEngine;
  serviceName: string;
  volumeName: string;
  hostnameAlias: string;
  databaseName: string;
  username: string;
  password: string;
  projectSlug: string;
  /** Stamped on Spec.Labels + ContainerSpec.Labels so each task carries
   *  the deployment id back through to the Deployments tab. */
  deploymentId: string;
  /** Optional `<repo>:<tag>` override. Defaults to the adapter's pinned
   *  image. Drives the wizard's version picker — pass the chosen tag here
   *  and swarm pulls that exact build. */
  image?: string;
  /** User-added envs merged before the engine's identity envs are
   *  appended. Reserved keys (set by the adapter) are filtered out so
   *  operators can't accidentally clobber the boot identity. */
  extraEnv?: Record<string, string>;
  /** Monotonic counter for TaskTemplate.ForceUpdate. Bumping it is the
   *  only way to make swarm roll a task when the spec is byte-identical. */
  forceUpdateCounter?: number;
}

function buildDatabaseSpec(
  input: ProvisionSwarmDatabaseInput,
  networkName: string,
) {
  const adapter = getEngineAdapter(input.engine);
  const image = input.image ?? adapter.defaultImage;

  // User envs come first, identity envs second — identity wins on key
  // collision. Reserved keys are stripped so a fat-fingered POSTGRES_PASSWORD
  // in extraEnv can't break the boot.
  const userEnv = Object.entries(input.extraEnv ?? {})
    .filter(([k]) => !adapter.reservedEnvKeys.has(k))
    .map(([k, v]) => `${k}=${v}`);
  const identityEnv = adapter.buildEnv({
    username: input.username,
    password: input.password,
    databaseName: input.databaseName,
  });
  const command = adapter.buildCommand?.({ password: input.password });

  // Identity labels mirror onto BOTH the service spec (so `docker service
  // ls` filters work) AND the container spec (so `docker container ls
  // --filter label=…` finds the actual replicas — that's what the
  // terminal-targets handler uses to populate the picker / per-resource
  // shell). Skipping ContainerSpec.Labels here meant terminals couldn't
  // find their own running container.
  const otterstackLabels = {
    "otterstack.managed": "true",
    "otterstack.resource.type": input.engine,
    "otterstack.project": input.projectSlug,
    "otterstack.deployment.id": input.deploymentId,
  };

  return {
    Name: input.serviceName,
    Labels: otterstackLabels,
    TaskTemplate: {
      ContainerSpec: {
        Image: image,
        Labels: otterstackLabels,
        Env: [...userEnv, ...identityEnv],
        ...(command ? { Command: command } : {}),
        Mounts: [
          {
            Type: "volume" as const,
            Source: input.volumeName,
            Target: adapter.mountTarget,
          },
        ],
        Healthcheck: {
          Test: [
            "CMD-SHELL",
            adapter.buildHealthcheck({
              username: input.username,
              password: input.password,
              databaseName: input.databaseName,
            }),
          ],
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
        Condition: "on-failure" as const,
        MaxAttempts: 5,
        Delay: 5_000_000_000,
      },
      ForceUpdate: input.forceUpdateCounter ?? 1,
    },
    Mode: {
      Replicated: { Replicas: 1 },
    },
    // `stop-first` is mandatory for stateful single-replica services: the
    // database owns a persistent volume that exactly one process can hold
    // open at a time. With `start-first` swarm boots the new task before
    // stopping the old, both mount the same volume, the second postgres
    // sees a stale postmaster.pid and immediately shuts down — taking
    // both tasks with it (we observed exactly this with TZ=UTC redeploys).
    // Trade-off: ~5–10s of write outage during the gap; acceptable for an
    // intentional redeploy.
    UpdateConfig: {
      Parallelism: 1,
      Delay: 0,
      Order: "stop-first" as const,
      FailureAction: "rollback" as const,
      Monitor: 10_000_000_000,
      MaxFailureRatio: 0,
    },
    RollbackConfig: {
      Parallelism: 1,
      Delay: 0,
      Order: "stop-first" as const,
      FailureAction: "pause" as const,
      Monitor: 10_000_000_000,
      MaxFailureRatio: 0,
    },
    EndpointSpec: {
      Ports: [
        {
          Protocol: "tcp" as const,
          TargetPort: adapter.port,
          PublishMode: "host" as const,
        },
      ],
    },
  };
}

export async function provisionSwarmDatabase(
  input: ProvisionSwarmDatabaseInput,
  rlog?: RequestLogger,
): Promise<SwarmDatabaseRuntime> {
  const docker = Docker.fromEnv();
  const swarmStep = (event: Record<string, unknown>) =>
    log.info({
      swarm: {
        service: input.serviceName,
        engine: input.engine,
        ...event,
      },
    });

  swarmStep({ step: "ensure-network", status: "start", project: input.projectSlug });
  const networkName = await ensureProjectNetwork(input.projectSlug, rlog);
  swarmStep({ step: "ensure-network", status: "ok", network: networkName });

  swarmStep({ step: "inspect-existing", status: "start" });
  const existing = await inspectSwarmService(docker, input.serviceName, networkName);
  if (existing) {
    swarmStep({
      step: "inspect-existing",
      status: "found",
      runtimeStatus: existing.status,
    });
    docker.destroy();
    return existing;
  }
  swarmStep({ step: "inspect-existing", status: "missing" });

  swarmStep({ step: "service-create", status: "start" });
  const createResult = await docker.services.create(
    buildDatabaseSpec(input, networkName),
  );
  if (createResult.isErr()) {
    swarmStep({
      step: "service-create",
      status: "error",
      message: createResult.error.message,
    });
    docker.destroy();
    throw createResult.error;
  }
  swarmStep({ step: "service-create", status: "ok" });

  swarmStep({ step: "wait-ready", status: "start" });
  const runtime = await waitForServiceReady(docker, input.serviceName, networkName);
  swarmStep({ step: "wait-ready", status: runtime.status, health: runtime.health });
  docker.destroy();
  return runtime;
}

export async function updateSwarmDatabase(
  input: ProvisionSwarmDatabaseInput,
  rlog?: RequestLogger,
): Promise<SwarmDatabaseRuntime> {
  const docker = Docker.fromEnv();
  const swarmStep = (event: Record<string, unknown>) =>
    log.info({
      swarm: {
        service: input.serviceName,
        engine: input.engine,
        op: "update",
        ...event,
      },
    });

  swarmStep({ step: "ensure-network", status: "start" });
  const networkName = await ensureProjectNetwork(input.projectSlug, rlog);
  swarmStep({ step: "ensure-network", status: "ok", network: networkName });

  const existing = await inspectSwarmService(docker, input.serviceName, networkName);
  if (!existing || !existing.serviceId) {
    swarmStep({
      step: "inspect-existing",
      status: "missing",
      action: "fallback-to-provision",
    });
    docker.destroy();
    return provisionSwarmDatabase(input, rlog);
  }
  swarmStep({
    step: "inspect-existing",
    status: "found",
    serviceId: existing.serviceId,
  });

  const inspectResult = await docker.services
    .getService(existing.serviceId)
    .inspect();
  if (inspectResult.isErr()) {
    swarmStep({
      step: "service-inspect",
      status: "error",
      message: inspectResult.error.message,
    });
    docker.destroy();
    throw inspectResult.error;
  }

  const currentVersion = inspectResult.value.Version?.Index;
  if (currentVersion === undefined) {
    swarmStep({ step: "service-inspect", status: "error", message: "no Version index" });
    docker.destroy();
    throw new Error(
      `Swarm service ${input.serviceName} has no Version index; cannot update`,
    );
  }

  const existingForceUpdate = (() => {
    const value = (
      inspectResult.value.Spec?.TaskTemplate as
        | { ForceUpdate?: number }
        | undefined
    )?.ForceUpdate;
    return typeof value === "number" ? value : 0;
  })();
  const bumpedInput: ProvisionSwarmDatabaseInput = {
    ...input,
    forceUpdateCounter: existingForceUpdate + 1,
  };

  swarmStep({
    step: "service-update",
    status: "start",
    version: currentVersion,
    forceUpdate: bumpedInput.forceUpdateCounter,
  });
  const newSpec = buildDatabaseSpec(bumpedInput, networkName);
  const updateResult = await docker.services
    .getService(existing.serviceId)
    .update({
      version: currentVersion,
      Name: newSpec.Name,
      Labels: newSpec.Labels,
      TaskTemplate: newSpec.TaskTemplate,
      Mode: newSpec.Mode,
      UpdateConfig: newSpec.UpdateConfig,
      RollbackConfig: newSpec.RollbackConfig,
      EndpointSpec: newSpec.EndpointSpec,
    });

  if (updateResult.isErr()) {
    swarmStep({
      step: "service-update",
      status: "error",
      message: updateResult.error.message,
    });
    docker.destroy();
    throw updateResult.error;
  }
  swarmStep({ step: "service-update", status: "ok" });

  swarmStep({ step: "wait-ready", status: "start" });
  const runtime = await waitForServiceReady(docker, input.serviceName, networkName);
  swarmStep({ step: "wait-ready", status: runtime.status, health: runtime.health });
  docker.destroy();
  return runtime;
}

export async function inspectSwarmDatabaseRuntime(input: {
  serviceName: string;
  volumeName: string;
  projectSlug: string;
}): Promise<SwarmDatabaseRuntime> {
  const docker = Docker.fromEnv();
  const networkName = `${PLATFORM.swarm.networkPrefix}${input.projectSlug}`;

  const runtime = await inspectSwarmService(docker, input.serviceName, networkName);
  docker.destroy();

  return (
    runtime ?? {
      serviceId: null,
      serviceName: input.serviceName,
      volumeName: input.volumeName,
      networkName,
      status: "missing",
      health: null,
    }
  );
}

export async function destroySwarmDatabase(
  input: { serviceName: string },
  rlog?: RequestLogger,
): Promise<void> {
  const stepLog = asStepLogger(rlog);
  const docker = Docker.fromEnv();

  const listResult = await docker.services.list({
    filters: { name: [input.serviceName] },
  });

  if (listResult.isErr()) {
    docker.destroy();
    throw listResult.error;
  }

  const service = listResult.value.find(
    (s) => s.Spec?.Name === input.serviceName,
  );
  if (!service) {
    docker.destroy();
    return;
  }

  stepLog.info({ swarm: { step: "remove-service", service: input.serviceName } });
  if (!service.ID) {
    docker.destroy();
    return;
  }
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
): Promise<SwarmDatabaseRuntime | null> {
  const listResult = await docker.services.list({
    filters: { name: [serviceName] },
  });

  if (listResult.isErr()) throw listResult.error;

  const service = listResult.value.find((s) => s.Spec?.Name === serviceName);
  if (!service) return null;

  const tasksResult = await docker.tasks.list({
    filters: { service: [serviceName] },
  });
  if (tasksResult.isErr()) throw tasksResult.error;

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

  const mounts = (
    service.Spec?.TaskTemplate as
      | { ContainerSpec?: { Mounts?: Array<{ Source?: string }> } }
      | undefined
  )?.ContainerSpec?.Mounts;
  return {
    serviceId: service.ID ?? null,
    serviceName,
    volumeName: mounts?.[0]?.Source ?? "",
    networkName,
    status,
    health,
  };
}

function mapTaskStateToStatus(
  state: string | undefined,
): SwarmDatabaseRuntime["status"] {
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
): SwarmDatabaseRuntime["health"] {
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
): Promise<SwarmDatabaseRuntime> {
  let lastState: string | null = null;
  const tick = (event: Record<string, unknown>) =>
    log.info({ swarm: { service: serviceName, step: "wait-ready", ...event } });

  // Event-driven wakeups. Each `task.update` for our service nudges the
  // loop to re-inspect immediately instead of waiting the full 1s tick.
  // The poll cap stays (60 attempts ≈ 60s) so a daemon that's somehow
  // dropping events still terminates — events are best-effort, the cap
  // is authoritative. The wakeup function resolves on event OR the 1s
  // floor, whichever first.
  const wakeup = createTaskUpdateWakeup(serviceName);
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      const runtime = await inspectSwarmService(docker, serviceName, networkName);
      const state = runtime?.status ?? "missing";

      if (state !== lastState) {
        tick({
          status: "tick",
          attempt,
          runtimeStatus: state,
          health: runtime?.health ?? null,
        });
        lastState = state;
      }

      if (runtime && runtime.status === "running") return runtime;
      if (runtime && runtime.status === "error") {
        tick({ status: "error", attempt, message: "service entered error state" });
        return runtime;
      }

      await wakeup.next(1000);
    }

    tick({ status: "timeout", attempt: 60 });
    const runtime = await inspectSwarmService(docker, serviceName, networkName);
    return (
      runtime ?? {
        serviceId: null,
        serviceName,
        volumeName: "",
        networkName,
        status: "error",
        health: null,
      }
    );
  } finally {
    wakeup.close();
  }
}

/**
 * One-shot wakeup primitive over the docker event bus. Each call to
 * `.next(ms)` resolves on the next `task.update` for the given service or
 * after `ms`, whichever first. Events that arrive while no one is waiting
 * are coalesced into a single pending wakeup, so a burst of state
 * transitions wakes the loop once.
 *
 * Lifecycle is caller-owned via `close()` — the wait-ready loop's
 * `try/finally` guarantees the subscription tears down even on error /
 * early return.
 */
function createTaskUpdateWakeup(serviceName: string): {
  next: (ms: number) => Promise<void>;
  close: () => void;
} {
  let pending = false;
  let resolveCurrent: (() => void) | null = null;

  const sub = subscribeDockerEvents((event) => {
    if (event.kind !== "task") return;
    // Swarm tags task events with the originating service's NAME (not
    // just id) — use it as the filter so we don't have to resolve the
    // service id ourselves.
    if (event.labels["com.docker.swarm.service.name"] !== serviceName) return;
    if (resolveCurrent) {
      const r = resolveCurrent;
      resolveCurrent = null;
      r();
    } else {
      pending = true;
    }
  });

  return {
    next: (ms: number) =>
      new Promise<void>((resolve) => {
        if (pending) {
          pending = false;
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          if (resolveCurrent === inner) resolveCurrent = null;
          resolve();
        }, ms);
        const inner = () => {
          clearTimeout(timer);
          resolve();
        };
        resolveCurrent = inner;
      }),
    close: () => sub.close(),
  };
}

// ─── Catalog re-exports for convenience ────────────────────────────────
export { DATABASE_ENGINES };
