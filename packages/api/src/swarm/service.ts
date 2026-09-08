import { Docker } from "@otterdeploy/docker";
import { createError, type RequestLogger } from "evlog";

import type { SpecMount } from "./file-mounts";
import type { RegistryAuth } from "./image-pull";

import { asStepLogger } from "../lib/logger";
import { ensureProjectNetwork } from "./client";
import { applyableSwarmExtraNetworks } from "./extra-networks";
import { buildServiceSpec, inspectSwarmService, waitForServiceReady } from "./internals";

export interface SwarmServiceRuntime {
  serviceId: string | null;
  serviceName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
  /** When `status` is "error", the swarm task's failure reason (e.g. an image
   *  that can't be pulled), so callers can report *why* instead of a generic
   *  error. Absent/null on healthy or still-converging services. */
  errorMessage?: string | null;
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
  /** `scopeSuffix(scope)` for the environment (or preview) this runs in: ""
   *  for base/main, `-<env>`, `-pr-<n>`. Selects the overlay network, so a
   *  service can only resolve hostnames belonging to its own environment.
   *  Optional and defaulting to base, so a caller that has no scope keeps the
   *  network it already uses. */
  networkScopeSuffix?: string;

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
   * is handed to docker. The SpecMount entries here always reference a
   * real source path or volume name. Pass an empty array for no mounts.
   */
  mounts: SpecMount[];

  /**
   * Extra operator-created docker networks to join, by NAME, in addition to
   * the always-on project network (which carries the service's DNS aliases
   * and Caddy routing: it is never detachable). The drivers apply these
   * best-effort: a name that no longer resolves to a live network of the
   * right driver is skipped with a log line, never a failed deploy.
   */
  extraNetworks?: string[];

  forceUpdateCounter: number;

  /**
   * The deployment row this rollout serves. Stamped as the
   * `otterdeploy.deployment.id` label on BOTH the service and the container
   * spec so live swarm tasks can be bucketed back to their deployment. That's
   * what feeds the per-deployment task counts (the "N/M replica" badge and
   * "N tasks" history) in the deployments tab. Mirrors the database spec.
   * Null when no deployment row exists yet (e.g. an image service created
   * before its first deploy); the label is then omitted.
   */
  deploymentId?: string | null;

  /**
   * Credentials for pulling `image`, already resolved (see
   * `resolveRegistryAuth`). Null/absent means an anonymous pull.
   *
   * Resolved into the spec rather than looked up by the driver so there is ONE
   * place that decides which credential a deploy uses, and so the drivers stay
   * free of database access. Before this the resolver had exactly one caller,
   * the Postgres create stream, which meant every SERVICE deploy pulled
   * anonymously and a private image simply failed with "unauthorized" no
   * matter what the operator had configured on the Registries page (od-8562).
   *
   * Consumed by BOTH runtimes. The docker driver hands it to the pull;
   * `buildServiceSpec` sends it as `authconfig` (the X-Registry-Auth header)
   * on swarm service create AND update, which is what `docker service create
   * --with-registry-auth` does. Update matters as much as create: a rolling
   * update pulls the image again on whichever node takes the new task, so
   * authenticating only the create would work once and fail every deploy
   * after (od-1ifu).
   */
  registryAuth?: RegistryAuth | null;

  /**
   * Swarm node id this service is pinned to, already resolved from the
   * resource's `placementServerId` (see swarm/resolve-placement). Null/absent
   * leaves the scheduler free, which is the right default for stateless work.
   * A pinned service does not fail over.
   */
  placementNodeId?: string | null;
}

// ---------------------------------------------------------------------------
// Provision (idempotent on serviceName)
// ---------------------------------------------------------------------------

export async function provisionSwarmService(
  spec: SwarmServiceSpec,
  rlog?: RequestLogger,
): Promise<SwarmServiceRuntime> {
  const docker = Docker.fromEnv();

  const networkName = await ensureProjectNetwork(
    spec.projectSlug,
    spec.networkScopeSuffix ?? "",
    rlog,
  );

  const existing = await inspectSwarmService(docker, spec.serviceName, networkName);
  if (existing) {
    docker.destroy();
    return existing;
  }

  // Filter the extras against the live daemon FIRST: swarm rejects the whole
  // create if any Networks target is missing or not an overlay.
  const extraNetworks = await applyableSwarmExtraNetworks(docker, spec, networkName, rlog);
  const createResult = await docker.services.create(
    buildServiceSpec({ ...spec, extraNetworks }, networkName),
  );

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

  const networkName = await ensureProjectNetwork(
    spec.projectSlug,
    spec.networkScopeSuffix ?? "",
    rlog,
  );
  const existing = await inspectSwarmService(docker, spec.serviceName, networkName);
  if (!existing) {
    // Not yet provisioned: fall through to provision path.
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

  // Same live filter as the provision path: a deleted extra network must
  // degrade to a logged skip, not a failed rolling update.
  const extraNetworks = await applyableSwarmExtraNetworks(docker, spec, networkName, rlog);
  const newSpec = buildServiceSpec({ ...spec, extraNetworks }, networkName);
  const updateResult = await docker.services.getService(existing.serviceId ?? "").update({
    version: currentVersion,
    Name: newSpec.Name,
    Labels: newSpec.Labels,
    TaskTemplate: newSpec.TaskTemplate,
    Mode: newSpec.Mode,
    UpdateConfig: newSpec.UpdateConfig,
    RollbackConfig: newSpec.RollbackConfig,
    EndpointSpec: newSpec.EndpointSpec,
    // Carried on UPDATE too, not just create. A rolling update pulls the image
    // again on whichever node takes the new task, so omitting it here would
    // authenticate the first deploy and then fail every one after it.
    authconfig: newSpec.authconfig,
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
// Restart (forces task replacement with current spec, caller has bumped
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
  input: { serviceName: string; projectSlug: string; networkScopeSuffix?: string },
  rlog?: RequestLogger,
): Promise<SwarmServiceRuntime> {
  const docker = Docker.fromEnv();
  const networkName = await ensureProjectNetwork(
    input.projectSlug,
    input.networkScopeSuffix ?? "",
    rlog,
  );
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

/**
 * Take a service to zero replicas: the ONLY thing that stops a swarm crash
 * loop.
 *
 * `RestartPolicy.MaxAttempts` (internals.ts) caps how many times ONE TASK is
 * retried, and it does that correctly. But when a task exhausts its attempts
 * the orchestrator schedules a REPLACEMENT task to satisfy the replica count,
 * with a fresh counter, forever — so from the outside the cap is invisible.
 * One production stack booted ~1,150 times behind a working `MaxAttempts: 5`.
 *
 * Swarm has no service-level "give up", so the only lever is the desired state
 * it converges on. Setting replicas to 0 is what actually ends it, and it is
 * deliberately reversible: the spec, volumes and routes all survive, so a
 * redeploy (or a manual scale-up) brings the service straight back. Removing
 * the service would end the loop too and take the operator's stack with it.
 *
 * Returns false when there is nothing to scale (already gone, or not
 * replicated), so callers can stay quiet rather than reporting an action they
 * did not take.
 */
export async function scaleSwarmServiceToZero(
  input: { serviceName: string },
  rlog?: RequestLogger,
): Promise<boolean> {
  const log = asStepLogger(rlog);
  const docker = Docker.fromEnv();

  try {
    const listResult = await docker.services.list({
      filters: { name: [input.serviceName] },
    });
    if (listResult.isErr()) return false;

    const service = listResult.value.find((s) => s.Spec?.Name === input.serviceName);
    if (!service?.ID) return false;

    const inspected = await docker.services.getService(service.ID).inspect();
    if (inspected.isErr()) return false;

    const version = inspected.value.Version?.Index;
    const spec = inspected.value.Spec;
    // A global service has no replica count to zero; leave it alone rather
    // than writing a Mode it never had.
    if (version === undefined || !spec?.Mode?.Replicated) return false;
    if (spec.Mode.Replicated.Replicas === 0) return false;

    log.info({ swarm: { step: "scale-to-zero", service: input.serviceName } });
    const updated = await docker.services.getService(service.ID).update({
      version,
      Name: spec.Name,
      Labels: spec.Labels,
      TaskTemplate: spec.TaskTemplate,
      Mode: { Replicated: { Replicas: 0 } },
      UpdateConfig: spec.UpdateConfig,
      RollbackConfig: spec.RollbackConfig,
      EndpointSpec: spec.EndpointSpec,
    });
    return updated.isOk();
  } finally {
    docker.destroy();
  }
}

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
