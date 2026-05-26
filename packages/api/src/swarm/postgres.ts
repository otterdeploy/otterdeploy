import { setTimeout as sleep } from "node:timers/promises";
import { Docker } from "@otterdeploy/docker";
import { log, type RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";
import { PLATFORM } from "../constants";
import { ensureProjectNetwork } from "./client";

export interface SwarmPostgresRuntime {
  serviceId: string | null;
  serviceName: string;
  volumeName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
}

interface ProvisionSwarmPostgresInput {
  serviceName: string;
  volumeName: string;
  hostnameAlias: string;
  databaseName: string;
  username: string;
  password: string;
  projectSlug: string;
  /** ID of the deployment row this swarm push corresponds to. Stamped onto
   *  both Spec.Labels (for service-level lookup) and the container spec
   *  labels (so each task swarm spawns carries the deployment id back —
   *  that's how the Deployments tab groups task rows under deployments). */
  deploymentId: string;
  /**
   * User-added envs merged with the derived POSTGRES_USER/PASSWORD/DB before
   * the container spec is rendered. Values are stringified verbatim; the
   * derived three always win on key collision.
   */
  extraEnv?: Record<string, string>;
  /**
   * Monotonic ForceUpdate counter for `TaskTemplate.ForceUpdate`. Bumping it
   * is the only way to force swarm to roll a task when nothing else in the
   * TaskTemplate diff'd — required for "restart" semantics and for
   * redeploys when the image tag is identical but the registry content
   * changed. Create defaults to 1; update reads the existing counter and
   * passes `existing + 1`.
   */
  forceUpdateCounter?: number;
}

// Shared spec builder for create + update so the env merge logic and
// healthcheck wiring stay in one place.
function buildPostgresSpec(input: ProvisionSwarmPostgresInput, networkName: string) {
  return {
    Name: input.serviceName,
    Labels: {
      "otterstack.managed": "true",
      "otterstack.resource.type": "postgres",
      "otterstack.project": input.projectSlug,
      "otterstack.deployment.id": input.deploymentId,
    },
    TaskTemplate: {
      ContainerSpec: {
        Image: PLATFORM.docker.postgresImage,
        Labels: {
          "otterstack.deployment.id": input.deploymentId,
        },
        // Derived envs are appended after `extraEnv` so they overwrite any
        // user value that collides with the database identity. The DB image
        // refuses to boot if these are missing, so we never let them be
        // overridden via the user editor.
        Env: [
          ...Object.entries(input.extraEnv ?? {})
            .filter(
              ([k]) =>
                k !== "POSTGRES_DB" &&
                k !== "POSTGRES_USER" &&
                k !== "POSTGRES_PASSWORD",
            )
            .map(([k, v]) => `${k}=${v}`),
          `POSTGRES_DB=${input.databaseName}`,
          `POSTGRES_USER=${input.username}`,
          `POSTGRES_PASSWORD=${input.password}`,
        ],
        Mounts: [
          {
            Type: "volume" as const,
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
        Condition: "on-failure" as const,
        MaxAttempts: 5,
        Delay: 5_000_000_000,
      },
      ForceUpdate: input.forceUpdateCounter ?? 1,
    },
    Mode: {
      Replicated: {
        Replicas: 1,
      },
    },
    // Roll one task at a time, start the new one BEFORE stopping the old
    // (`start-first`) so connections aren't dropped during a redeploy of
    // a multi-replica db. Auto-rollback on failure means a bad spec push
    // leaves us with the previous working task instead of zero healthy
    // tasks. Monitor=10s gives the new task time to pass its healthcheck
    // before swarm considers the update successful.
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
    EndpointSpec: {
      Ports: [
        {
          Protocol: "tcp" as const,
          TargetPort: 5432,
          PublishMode: "host" as const,
        },
      ],
    },
  };
}

export async function provisionSwarmPostgres(
  input: ProvisionSwarmPostgresInput,
  rlog?: RequestLogger,
): Promise<SwarmPostgresRuntime> {
  const docker = Docker.fromEnv();
  // Use the global logger directly so each step emits an immediate standalone
  // event. The request-scoped `rlog` only flushes its wide event at request
  // end — useless for live progress during a 30s provision. The trace
  // middleware still emits the request-level event with action/actor/outcome
  // at end, so we get both: real-time steps here + audit summary there.
  const swarmStep = (event: Record<string, unknown>) =>
    log.info({ swarm: { service: input.serviceName, ...event } });

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
  const createResult = await docker.services.create(buildPostgresSpec(input, networkName));
  if (createResult.isErr()) {
    swarmStep({ step: "service-create", status: "error", message: createResult.error.message });
    docker.destroy();
    throw createResult.error;
  }
  swarmStep({ step: "service-create", status: "ok" });

  swarmStep({ step: "wait-ready", status: "start" });
  const runtime = await waitForServiceReady(docker, input.serviceName, networkName);
  swarmStep({
    step: "wait-ready",
    status: runtime.status,
    health: runtime.health,
  });
  docker.destroy();
  return runtime;
}

/**
 * Roll the running Postgres service with a new env array. Inspects the
 * existing service, bumps its Version, and calls `services.update()` — same
 * pattern as `updateSwarmService` in service.ts. Volume + network stay put;
 * only the container Env changes. Existing connections drop while the new
 * task starts (a few seconds), then come back up.
 */
export async function updateSwarmPostgres(
  input: ProvisionSwarmPostgresInput,
  rlog?: RequestLogger,
): Promise<SwarmPostgresRuntime> {
  const docker = Docker.fromEnv();
  const swarmStep = (event: Record<string, unknown>) =>
    log.info({ swarm: { service: input.serviceName, op: "update", ...event } });

  swarmStep({ step: "ensure-network", status: "start" });
  const networkName = await ensureProjectNetwork(input.projectSlug, rlog);
  swarmStep({ step: "ensure-network", status: "ok", network: networkName });

  const existing = await inspectSwarmService(docker, input.serviceName, networkName);
  if (!existing || !existing.serviceId) {
    // Nothing to update — fall back to provision so the resource is in a
    // consistent state regardless of how we got here.
    swarmStep({ step: "inspect-existing", status: "missing", action: "fallback-to-provision" });
    docker.destroy();
    return provisionSwarmPostgres(input, rlog);
  }
  swarmStep({ step: "inspect-existing", status: "found", serviceId: existing.serviceId });

  const inspectResult = await docker.services.getService(existing.serviceId).inspect();
  if (inspectResult.isErr()) {
    swarmStep({ step: "service-inspect", status: "error", message: inspectResult.error.message });
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

  // Bump ForceUpdate so swarm actually rolls the task even if the rest of
  // the TaskTemplate is byte-identical (same image tag, same env, etc.).
  // Without this, an update that only matters semantically — like "the
  // postgres image was rebuilt with a CVE patch but the tag is unchanged"
  // — would no-op silently. Read the live value off the running service
  // and add 1; create defaults to 1 in buildPostgresSpec.
  const existingForceUpdate = (() => {
    const value = (
      inspectResult.value.Spec?.TaskTemplate as
        | { ForceUpdate?: number }
        | undefined
    )?.ForceUpdate;
    return typeof value === "number" ? value : 0;
  })();
  const bumpedInput = {
    ...input,
    forceUpdateCounter: existingForceUpdate + 1,
  };

  swarmStep({
    step: "service-update",
    status: "start",
    version: currentVersion,
    forceUpdate: bumpedInput.forceUpdateCounter,
  });
  const newSpec = buildPostgresSpec(bumpedInput, networkName);
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
    swarmStep({ step: "service-update", status: "error", message: updateResult.error.message });
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

export async function destroySwarmPostgres(
  input: { serviceName: string },
  rlog?: RequestLogger,
): Promise<void> {
  const log = asStepLogger(rlog);
  const docker = Docker.fromEnv();

  const listResult = await docker.services.list({
    filters: { name: [input.serviceName] },
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
    filters: { name: [serviceName] },
  });

  if (listResult.isErr()) {
    throw listResult.error;
  }

  const service = listResult.value.find((s) => s.Spec?.Name === serviceName);
  if (!service) {
    return null;
  }

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
  // Log a state transition only when it changes — the loop polls once a
  // second so naive per-tick logging would flood the operator's terminal.
  let lastState: string | null = null;
  const tick = (event: Record<string, unknown>) =>
    log.info({ swarm: { service: serviceName, step: "wait-ready", ...event } });

  for (let attempt = 0; attempt < 60; attempt++) {
    const runtime = await inspectSwarmService(docker, serviceName, networkName);
    const state = runtime?.status ?? "missing";

    if (state !== lastState) {
      tick({ status: "tick", attempt, runtimeStatus: state, health: runtime?.health ?? null });
      lastState = state;
    }

    if (runtime && runtime.status === "running") {
      return runtime;
    }

    if (runtime && runtime.status === "error") {
      tick({ status: "error", attempt, message: "service entered error state" });
      return runtime;
    }

    await sleep(1000);
  }

  tick({ status: "timeout", attempt: 60 });
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
