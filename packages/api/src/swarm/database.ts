/**
 * Generic swarm spec / provision / update / inspect / destroy for any
 * supported database engine. All engine-specific knobs (image, env scheme,
 * healthcheck, mount path, optional --requirepass-style command) come from
 * the adapter in `./database-engines`. The orchestration code below (network
 * ensure, service create, ForceUpdate bump on update, wait-ready polling,
 * task state mapping) is engine-agnostic.
 */

import { Docker } from "@otterdeploy/docker";
import { type DatabaseEngine } from "@otterdeploy/shared/database-engines";
import { log, type RequestLogger } from "evlog";

import { PLATFORM } from "../constants";
import { asStepLogger } from "../lib/logger";
import { ensureProjectNetwork } from "./client";
import { buildDatabaseSpec, inspectSwarmService, waitForServiceReady } from "./database-internals";

export interface SwarmDatabaseRuntime {
  serviceId: string | null;
  serviceName: string;
  volumeName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
  /** Only set by `provisionSwarmDatabase` / `updateSwarmDatabase`: true
   *  when this call actually issued `docker services create`, false when
   *  the existing-service guard short-circuited and we returned the
   *  pre-existing runtime. Lets callers tell "I provisioned a new
   *  deployment" from "I found one already there" — when false, no task
   *  will inherit the new deployment.id label, so any deployment row the
   *  caller inserted would otherwise hang at BUILDING with 0 tasks
   *  forever. Read-side helpers (inspect*) leave it undefined. */
  wasCreated?: boolean;
}

export interface ProvisionSwarmDatabaseInput {
  engine: DatabaseEngine;
  /** Resource row id, stamped on the container as `otterdeploy.resource.id`
   *  so the metrics sampler can key its CPU/memory/network samples back to
   *  this resource. Services set the same label; without it the sampler skips
   *  the container and the resource charts no metrics. */
  resourceId: string;
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
  /** When true, publish the engine's port on the swarm node's host
   *  interface (PublishMode=host). Off by default — services in the same
   *  project reach the DB via overlay DNS at `<serviceName>:<port>`, no
   *  host binding required. Flip on only when the operator explicitly
   *  enables "public access" so we don't compete for ephemeral host ports
   *  on every DB. Coolify / Dokploy follow the same opt-in model. */
  public?: boolean;
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
    return { ...existing, wasCreated: false };
  }
  swarmStep({ step: "inspect-existing", status: "missing" });

  swarmStep({ step: "service-create", status: "start" });
  const createResult = await docker.services.create(buildDatabaseSpec(input, networkName));
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
  return { ...runtime, wasCreated: true };
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

  const inspectResult = await docker.services.getService(existing.serviceId).inspect();
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
    throw new Error(`Swarm service ${input.serviceName} has no Version index; cannot update`);
  }

  const existingForceUpdate = (() => {
    const value = (inspectResult.value.Spec?.TaskTemplate as { ForceUpdate?: number } | undefined)
      ?.ForceUpdate;
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
  const updateResult = await docker.services.getService(existing.serviceId).update({
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
  // updateSwarmDatabase always bumps ForceUpdate (line 294), so swarm
  // rolls a fresh task with the new deployment.id label even when the
  // spec is byte-identical. From the caller's perspective the deployment
  // it inserted is real.
  return { ...runtime, wasCreated: true };
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

  const service = listResult.value.find((s) => s.Spec?.Name === input.serviceName);
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
