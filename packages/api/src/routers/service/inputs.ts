/**
 * Handler input types — kept separate from `handlers.ts` to keep the
 * orchestration file readable. These mirror the zod schemas in
 * `contract.ts` (lossy in the brand types, which the handler boundary
 * casts in).
 */

import { type ProjectId } from "../project/errors";
import { type ResourceId } from "./errors";

type RestartInput = {
  condition?: "none" | "on-failure" | "any";
  maxAttempts?: number | null;
  delayMs?: number;
};

type HealthcheckInput = {
  cmd?: string[] | null;
  intervalMs?: number | null;
  timeoutMs?: number | null;
  retries?: number | null;
  startMs?: number | null;
} | null;

type ResourcesInput = {
  cpuLimit?: number | null;
  memoryLimitMb?: number | null;
  cpuReservation?: number | null;
  memoryReservationMb?: number | null;
};

type PortInput = {
  containerPort: number;
  protocol?: "tcp" | "udp";
  appProtocol?: "http" | "tcp";
  isPrimary?: boolean;
};

/** Common (projectId, resourceId) addressing tuple used by most handlers. */
export type ResourceRef = {
  projectId: ProjectId;
  organizationId: string;
  resourceId: ResourceId;
};

/** Project-scoped addressing — used by `listServices`. */
export type ProjectRef = {
  projectId: ProjectId;
  organizationId: string;
};

export type CreateServiceInput = {
  projectId: ProjectId;
  organizationId: string;
  name: string;
  image: string;
  command?: string[] | null;
  entrypoint?: string[] | null;
  replicas?: number;
  ports: PortInput[];
  env?: Array<{ key: string; value: string }>;
  restart?: RestartInput;
  healthcheck?: HealthcheckInput;
  resources?: ResourcesInput;
};

export type UpdateServiceInput = {
  projectId: ProjectId;
  organizationId: string;
  resourceId: ResourceId;
  image?: string;
  command?: string[] | null;
  entrypoint?: string[] | null;
  replicas?: number;
  ports?: PortInput[];
  restart?: RestartInput;
  healthcheck?: HealthcheckInput;
  resources?: ResourcesInput;
};

// ---------------------------------------------------------------------------
// Adapters — translate handler inputs into the loose payload shapes that
// the queries module expects. Keeps the `null`/`undefined` choreography
// (used for "explicit clear" vs "leave alone") out of the orchestration.
// ---------------------------------------------------------------------------

/** Map create-time input into the wide payload `createServiceRecord` expects. */
export function toCreateRecordPayload(
  input: CreateServiceInput,
  extras: {
    ports: Array<{
      containerPort: number;
      protocol: "tcp" | "udp";
      appProtocol: "http" | "tcp";
      isPrimary: boolean;
    }>;
    serviceName: string;
    networkName: string;
    internalHostname: string;
  },
) {
  return {
    projectId: input.projectId,
    name: input.name,
    status: "draft" as const,
    image: input.image,
    command: input.command ?? null,
    entrypoint: input.entrypoint ?? null,
    replicas: input.replicas ?? 1,
    restartCondition: input.restart?.condition,
    restartMaxAttempts: input.restart?.maxAttempts ?? null,
    restartDelayMs: input.restart?.delayMs,
    healthcheckCmd: input.healthcheck?.cmd ?? null,
    healthcheckIntervalMs: input.healthcheck?.intervalMs ?? null,
    healthcheckTimeoutMs: input.healthcheck?.timeoutMs ?? null,
    healthcheckRetries: input.healthcheck?.retries ?? null,
    healthcheckStartMs: input.healthcheck?.startMs ?? null,
    cpuLimit:
      input.resources?.cpuLimit != null ? input.resources.cpuLimit.toString() : null,
    memoryLimitMb: input.resources?.memoryLimitMb ?? null,
    cpuReservation:
      input.resources?.cpuReservation != null
        ? input.resources.cpuReservation.toString()
        : null,
    memoryReservationMb: input.resources?.memoryReservationMb ?? null,
    internalHostname: extras.internalHostname,
    serviceName: extras.serviceName,
    networkName: extras.networkName,
    ports: extras.ports,
    env: input.env,
  };
}

/** Map patch input into the partial payload `updateServiceRecord` expects. */
export function toUpdateRecordPatch(input: UpdateServiceInput) {
  return {
    image: input.image,
    command: input.command,
    entrypoint: input.entrypoint,
    replicas: input.replicas,
    restartCondition: input.restart?.condition,
    restartMaxAttempts: input.restart?.maxAttempts,
    restartDelayMs: input.restart?.delayMs,
    healthcheckCmd: input.healthcheck?.cmd,
    healthcheckIntervalMs: input.healthcheck?.intervalMs,
    healthcheckTimeoutMs: input.healthcheck?.timeoutMs,
    healthcheckRetries: input.healthcheck?.retries,
    healthcheckStartMs: input.healthcheck?.startMs,
    cpuLimit:
      input.resources?.cpuLimit != null ? input.resources.cpuLimit.toString() : undefined,
    memoryLimitMb: input.resources?.memoryLimitMb,
    cpuReservation:
      input.resources?.cpuReservation != null
        ? input.resources.cpuReservation.toString()
        : undefined,
    memoryReservationMb: input.resources?.memoryReservationMb,
  };
}
