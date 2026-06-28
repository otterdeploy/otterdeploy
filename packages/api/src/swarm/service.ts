import { Docker } from "@otterdeploy/docker";
import { createError, type RequestLogger } from "evlog";

import type { SpecMount } from "./file-mounts";

import { asStepLogger } from "../lib/logger";
import { ensureProjectNetwork } from "./client";
import { buildServiceSpec, inspectSwarmService, waitForServiceReady } from "./internals";

export interface SwarmServiceRuntime {
  serviceId: string | null;
  serviceName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
}

export interface SwarmServicePort {
  containerPort: number;
  protocol: "tcp" | "udp";
  appProtocol: "http" | "tcp";
}

export interface SwarmServiceHealthcheck {
  cmd: string[];
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  startPeriodMs: number;
}

export interface SwarmServiceResources {
  cpuLimit?: number | null;
  memoryLimitMb?: number | null;
  cpuReservation?: number | null;
  memoryReservationMb?: number | null;
}

export interface SwarmServiceRestart {
  condition: "none" | "on-failure" | "any";
  maxAttempts?: number | null;
  delayMs: number;
}

export interface SwarmServiceSpec {
  resourceId: string;
  resourceName: string;
  projectSlug: string;
  serviceName: string;
  internalHostname: string;

  image: string;
  command?: string[] | null; // CMD
  entrypoint?: string[] | null; // ENTRYPOINT
  env: Record<string, string>;

  replicas: number;
  restart: SwarmServiceRestart;
  healthcheck?: SwarmServiceHealthcheck | null;
  resources?: SwarmServiceResources;
  ports: SwarmServicePort[];
  /**
   * Mounts attached to the container. File-type mounts MUST already be
   * materialized to disk (see materializeServiceMounts) before this spec
   * is handed to docker — the SpecMount entries here always reference a
   * real source path or volume name. Pass an empty array for no mounts.
   */
  mounts: SpecMount[];

  forceUpdateCounter: number;

  /**
   * The deployment row this rollout serves. Stamped as the
   * `otterdeploy.deployment.id` label on BOTH the service and the container
   * spec so live swarm tasks can be bucketed back to their deployment — that's
   * what feeds the per-deployment task counts (the "N/M replica" badge and
   * "N tasks" history) in the deployments tab. Mirrors the database spec.
   * Null when no deployment row exists yet (e.g. an image service created
   * before its first deploy); the label is then omitted.
   */
  deploymentId?: string | null;
}

// ---------------------------------------------------------------------------
// Provision (idempotent on serviceName)
// ---------------------------------------------------------------------------

export async function provisionSwarmService(
  spec: SwarmServiceSpec,
  rlog?: RequestLogger,
): Promise<SwarmServiceRuntime> {
  const docker = Docker.fromEnv();

  const networkName = await ensureProjectNetwork(spec.projectSlug, rlog);

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
  rlog?: RequestLogger,
): Promise<SwarmServiceRuntime> {
  const docker = Docker.fromEnv();

  const networkName = await ensureProjectNetwork(spec.projectSlug, rlog);
  const existing = await inspectSwarmService(docker, spec.serviceName, networkName);
  if (!existing) {
    // Not yet provisioned — fall through to provision path.
    docker.destroy();
    return provisionSwarmService(spec, rlog);
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
  const updateResult = await docker.services.getService(existing.serviceId ?? "").update({
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
  rlog?: RequestLogger,
): Promise<SwarmServiceRuntime> {
  return updateSwarmService(spec, rlog);
}

// ---------------------------------------------------------------------------
// Inspect
// ---------------------------------------------------------------------------

export async function inspectSwarmServiceRuntime(
  input: { serviceName: string; projectSlug: string },
  rlog?: RequestLogger,
): Promise<SwarmServiceRuntime> {
  const docker = Docker.fromEnv();
  const networkName = await ensureProjectNetwork(input.projectSlug, rlog);
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

export async function destroySwarmService(
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
