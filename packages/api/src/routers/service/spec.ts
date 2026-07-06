/**
 * Translates a stored `ServiceRecord` plus a resolved env map into the
 * provisioner-shaped `SwarmServiceSpec` consumed by `swarm/*`.
 */

import { type EnvScope, runtimeServiceName } from "../../lib/environment/scoping";
import { materializeServiceMounts, type SpecMount, type SwarmServiceSpec } from "../../swarm";
import { getLatestDeploymentForResource } from "../project/deployments";
import { type ServiceRecord } from "./queries";
import { sanitizeSlug } from "./views";

export async function buildSwarmSpec(
  record: ServiceRecord,
  resolvedEnv: Record<string, string>,
  projectSlug: string,
  // Optional preview scoping. Omitted / persistent → the base service name, so
  // every production deploy is byte-identical. A preview env runs the resource
  // as a distinct container (`<base>-pr-<n>`). See docs/designs/pr-previews.md.
  env?: EnvScope | null,
  // Preview builds pass their freshly-built image here instead of writing it to
  // the shared serviceResource.image column (which would clobber production's
  // image pointer). Omitted → the resource's stored image.
  imageOverride?: string | null,
): Promise<SwarmServiceSpec> {
  const serviceName = runtimeServiceName(record.service.serviceName, env);
  // Previews must not share the base container's DNS aliases on the project
  // network — Docker round-robins same-alias containers, so production
  // traffic could land on the preview. Every alias-feeding field
  // (serviceName, internalHostname, resourceName) gets the env scope;
  // persistent envs pass through byte-identical.
  const internalHostname = runtimeServiceName(record.service.internalHostname, env);
  const resourceName = runtimeServiceName(record.resource.name, env);
  // Stamp the rollout with the resource's latest deployment row. By the time
  // we build the spec the latest deployment IS the one being applied (the
  // build worker inserts the row before driving convergence; restart/expose/
  // update reapply against the current active deployment). This rides onto the
  // task labels so the deployments tab can count tasks per deployment.
  const latestDeployment = await getLatestDeploymentForResource(record.service.resourceId);
  // Materialize file-type mounts to disk before we ship the spec to swarm —
  // a bind-mount with no source on disk causes the container to fail to
  // start with no useful error. Volume + bind types pass through verbatim.
  const mounts: SpecMount[] = await materializeServiceMounts(
    serviceName,
    record.mounts.map((m) => ({
      type: m.type,
      target: m.target,
      source: m.source,
      content: m.content,
      readOnly: m.readOnly,
    })),
  );

  return {
    resourceId: record.resource.id,
    resourceName,
    projectSlug: sanitizeSlug(projectSlug),
    serviceName,
    internalHostname,
    image: imageOverride ?? record.service.image,
    command: record.service.command,
    entrypoint: record.service.entrypoint,
    env: resolvedEnv,
    replicas: record.service.replicas,
    restart: {
      condition: record.service.restartCondition,
      maxAttempts: record.service.restartMaxAttempts,
      delayMs: record.service.restartDelayMs,
    },
    healthcheck: record.service.healthcheckCmd
      ? {
          cmd: record.service.healthcheckCmd,
          intervalMs: record.service.healthcheckIntervalMs ?? 30_000,
          timeoutMs: record.service.healthcheckTimeoutMs ?? 5_000,
          retries: record.service.healthcheckRetries ?? 3,
          startPeriodMs: record.service.healthcheckStartMs ?? 0,
        }
      : null,
    resources: {
      cpuLimit: record.service.cpuLimit != null ? Number(record.service.cpuLimit) : null,
      memoryLimitMb: record.service.memoryLimitMb,
      cpuReservation:
        record.service.cpuReservation != null ? Number(record.service.cpuReservation) : null,
      memoryReservationMb: record.service.memoryReservationMb,
    },
    ports: record.ports.map((p) => ({
      containerPort: p.containerPort,
      protocol: p.protocol,
      appProtocol: p.appProtocol,
    })),
    mounts,
    forceUpdateCounter: record.service.forceUpdateCounter,
    deploymentId: latestDeployment?.id ?? null,
  };
}
