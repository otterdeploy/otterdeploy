/**
 * Translates a stored `ServiceRecord` plus a resolved env map into the
 * provisioner-shaped `SwarmServiceSpec` consumed by `swarm/*`.
 */

import { type ServiceRecord } from "./queries";
import { type SwarmServiceSpec } from "../../swarm";
import { sanitizeSlug } from "./views";

export function buildSwarmSpec(
  record: ServiceRecord,
  resolvedEnv: Record<string, string>,
  projectSlug: string,
): SwarmServiceSpec {
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
    forceUpdateCounter: record.service.forceUpdateCounter,
  };
}
