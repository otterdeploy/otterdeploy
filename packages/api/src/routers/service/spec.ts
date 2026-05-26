/**
 * Translates a stored `ServiceRecord` plus a resolved env map into the
 * provisioner-shaped `SwarmServiceSpec` consumed by `swarm/*`.
 */

import { type ServiceRecord } from "./queries";
import {
  materializeServiceMounts,
  type SpecMount,
  type SwarmServiceSpec,
} from "../../swarm";
import { sanitizeSlug } from "./views";

export async function buildSwarmSpec(
  record: ServiceRecord,
  resolvedEnv: Record<string, string>,
  projectSlug: string,
): Promise<SwarmServiceSpec> {
  // Materialize file-type mounts to disk before we ship the spec to swarm —
  // a bind-mount with no source on disk causes the container to fail to
  // start with no useful error. Volume + bind types pass through verbatim.
  const mounts: SpecMount[] = await materializeServiceMounts(
    record.service.serviceName,
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
    resourceName: record.resource.name,
    projectSlug: sanitizeSlug(projectSlug),
    serviceName: record.service.serviceName,
    internalHostname: record.service.internalHostname,
    image: record.service.image,
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
  };
}
