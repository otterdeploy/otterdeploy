/**
 * Map one service_resource record (with its ports/env/mounts) to a
 * StackService entry. No engine adapter — service resources speak the
 * spec users author directly.
 */

import type { listServiceRecordsByProject } from "../../routers/service/queries";

import type {
  StackHealthcheck,
  StackResources,
  StackService,
  StackVolumeMount,
} from "../schema";

import { projectNetworkName } from "./network-name";

type ServiceRecord = Awaited<
  ReturnType<typeof listServiceRecordsByProject>
>[number];

function nanosToCompose(ns: number | null | undefined): string | undefined {
  if (ns == null || ns <= 0) return undefined;
  return `${Math.round(ns / 1_000_000)}ms`;
}

function msToCompose(ms: number | null | undefined): string | undefined {
  if (ms == null || ms <= 0) return undefined;
  return `${ms}ms`;
}

function buildHealthcheck(
  s: ServiceRecord["service"],
): StackHealthcheck | undefined {
  if (!s.healthcheckCmd?.length) return undefined;
  return {
    test: ["CMD", ...s.healthcheckCmd],
    interval: nanosToCompose((s.healthcheckIntervalMs ?? 0) * 1_000_000),
    timeout: nanosToCompose((s.healthcheckTimeoutMs ?? 0) * 1_000_000),
    retries: s.healthcheckRetries ?? undefined,
    start_period: nanosToCompose((s.healthcheckStartMs ?? 0) * 1_000_000),
  };
}

function buildResources(s: ServiceRecord["service"]): StackResources {
  const memory = (mb: number | null) => (mb != null ? `${mb}M` : undefined);
  return {
    limits: { cpus: s.cpuLimit ?? undefined, memory: memory(s.memoryLimitMb) },
    reservations: {
      cpus: s.cpuReservation ?? undefined,
      memory: memory(s.memoryReservationMb),
    },
  };
}

function mapServiceMount(mount: ServiceRecord["mounts"][number]): StackVolumeMount {
  if (mount.type === "file") {
    return {
      type: "bind",
      source: mount.source ?? mount.target,
      target: mount.target,
      read_only: mount.readOnly,
      x_otterstack_content: mount.content ?? "",
    };
  }
  return {
    type: mount.type,
    source: mount.source ?? undefined,
    target: mount.target,
    read_only: mount.readOnly,
  };
}

export function buildServiceEntry(
  record: ServiceRecord,
  projectSlug: string,
): StackService {
  const s = record.service;
  const env: Record<string, string> = {};
  for (const e of record.env) env[e.key] = e.value;

  return {
    image: s.image,
    hostname: s.internalHostname,
    command: s.command ?? undefined,
    entrypoint: s.entrypoint ?? undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    ports: record.ports.map((p) => ({
      target: p.containerPort,
      protocol: p.protocol,
      app_protocol: p.appProtocol,
    })),
    volumes: record.mounts.map(mapServiceMount),
    networks: [projectNetworkName(projectSlug)],
    healthcheck: buildHealthcheck(s),
    deploy: {
      replicas: s.replicas,
      resources: buildResources(s),
      restart_policy: {
        condition: s.restartCondition,
        delay: msToCompose(s.restartDelayMs),
        max_attempts: s.restartMaxAttempts ?? undefined,
      },
    },
    "x-otterstack": {
      kind: "service",
      resourceId: record.resource.id,
      projectId: record.resource.projectId,
      publicEnabled: s.publicEnabled,
      publicHostname: s.publicDomain ?? undefined,
    },
  };
}
