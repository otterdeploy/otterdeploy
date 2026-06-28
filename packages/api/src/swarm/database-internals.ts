/**
 * Internal helpers for the swarm database driver (see `./database.ts`): the
 * engine-agnostic docker service-spec builder, service inspection + task-state
 * mapping, and the event-driven readiness poll. Split out of `./database.ts`
 * so that file stays focused on the exported provision/update/inspect/destroy
 * orchestration.
 */

import { Docker } from "@otterdeploy/docker";
import { log } from "evlog";

import type { ProvisionSwarmDatabaseInput, SwarmDatabaseRuntime } from "./database";

import { getEngineAdapter } from "./database-engines";
import { subscribeDockerEvents } from "./events";

export function buildDatabaseSpec(input: ProvisionSwarmDatabaseInput, networkName: string) {
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
  const otterdeployLabels = {
    "otterdeploy.managed": "true",
    "otterdeploy.resource.type": input.engine,
    "otterdeploy.resource.id": input.resourceId,
    "otterdeploy.project": input.projectSlug,
    "otterdeploy.deployment.id": input.deploymentId,
  };

  return {
    Name: input.serviceName,
    Labels: otterdeployLabels,
    TaskTemplate: {
      ContainerSpec: {
        Image: image,
        Labels: otterdeployLabels,
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
    // Databases are NEVER host-published — no raw engine port (5432, …) on the
    // node. Same-project apps reach the DB over the project overlay network
    // (Aliases above) at `<serviceName>:<port>`; public access goes through the
    // Caddy edge on :443 (TLS-SNI layer4 listener wrapper → overlay), driven by
    // the layer4 `proxy_route` row, not a host binding. `input.public` only
    // gates that route now. Empty Ports also clears any binding left by a
    // previously host-published deployment.
    // See docs/designs/db-tls-multiplex-443.md.
    EndpointSpec: {
      Ports: [],
    },
  };
}

export async function inspectSwarmService(
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

function mapTaskStateToStatus(state: string | undefined): SwarmDatabaseRuntime["status"] {
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

export async function waitForServiceReady(
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
