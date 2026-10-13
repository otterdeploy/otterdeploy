/**
 * The one translator from today's deploy specs to otterd's `ServiceSpec`.
 *
 * The deploy layer already builds a backend-neutral spec for every service
 * (`buildSwarmSpec` → `ContainerSpec`) and every database
 * (`ProvisionSwarmDatabaseInput` → `DatabaseSpec`); both runtimes consume
 * them. otterd consumes the same inputs through this file, so a resource
 * deploys identically whichever backend runs it, and the migration of an
 * existing install can compare a live container with what this produces.
 *
 * Lifecycle follows otterd's defaults (`normalizeServiceSpec`): anything
 * with a volume or bind mount, and every database, is `stay + exclusive`
 * (stop-first, its data never moves); mount-free services are shared and
 * reschedule. Env values are literals carried in the capability-protected
 * apply. A pinned server (`placementServerId`) becomes a hard node
 * constraint, resolved by the caller to the otterd node id.
 */
import {
  type ServiceSpec,
  type ServiceSpecInput,
  isAdmissible,
  normalizeServiceSpec,
  serviceSpecInput,
  validateServiceSpec,
} from "@otterdeploy/otterd-proto";
import { Result } from "better-result";

import type { ContainerSpec, DatabaseSpec } from "../runtime/types";

import { getEngineAdapter, resolveDatabaseMount } from "../swarm/database-engines";

export interface TranslateRefusal {
  code: "invalid";
  detail: string;
}

/** The otterd node id a pinned server resolves to, when it is pinned. */
export interface Placement {
  nodeId: string | null;
}

const NANO = 1_000_000_000;
const MIB = 1024 * 1024;

function finish(input: unknown): Result<ServiceSpec, TranslateRefusal> {
  const parsed = serviceSpecInput.safeParse(input);
  if (!parsed.success) return Result.err({ code: "invalid", detail: parsed.error.message });
  const spec = normalizeServiceSpec(parsed.data);
  if (!isAdmissible(spec)) {
    return Result.err({ code: "invalid", detail: JSON.stringify(validateServiceSpec(spec)) });
  }
  return Result.ok(spec);
}

const literalEnv = (env: Record<string, string>) =>
  Object.entries(env).map(([name, value]) => ({
    name,
    value: { kind: "literal" as const, value },
  }));

function resources(r: ContainerSpec["resources"]): ServiceSpecInput["task"]["resources"] {
  const limits = {
    ...(r?.cpuLimit ? { nanoCpus: Math.round(r.cpuLimit * NANO) } : {}),
    ...(r?.memoryLimitMb ? { memoryBytes: r.memoryLimitMb * MIB } : {}),
  };
  const reservations = {
    ...(r?.cpuReservation ? { nanoCpus: Math.round(r.cpuReservation * NANO) } : {}),
    ...(r?.memoryReservationMb ? { memoryBytes: r.memoryReservationMb * MIB } : {}),
  };
  return { limits, reservations };
}

/** A service (git, image or compose child) as an otterd ServiceSpec. */
export function serviceToSpec(
  spec: ContainerSpec,
  placement: Placement,
): Result<ServiceSpec, TranslateRefusal> {
  const named = [
    spec.serviceName,
    spec.internalHostname,
    spec.resourceName,
    spec.composeKeyAlias,
  ].filter((a): a is string => typeof a === "string" && a.length > 0);
  const aliases = [...new Set(named)];
  return finish({
    resourceId: spec.resourceId,
    mode: { kind: "replicated", replicas: spec.replicas },
    task: {
      container: {
        image: { reference: spec.image },
        ...(spec.entrypoint ? { command: spec.entrypoint } : {}),
        ...(spec.command ? { args: spec.command } : {}),
        env: literalEnv(spec.env),
        hostname: spec.internalHostname,
        labels: {
          "otterdeploy.managed": "true",
          "otterdeploy.resource.id": spec.resourceId,
          "otterdeploy.project": spec.projectSlug,
          ...(spec.deploymentId ? { "otterdeploy.deployment.id": spec.deploymentId } : {}),
        },
        ...(spec.stopSignal ? { stopSignal: spec.stopSignal } : {}),
        ...(spec.stopGracePeriodMs ? { stopGraceMs: spec.stopGracePeriodMs } : {}),
      },
      mounts: spec.mounts.map((m) => ({
        kind: m.Type,
        source: m.Source,
        target: m.Target,
        readOnly: m.ReadOnly,
      })),
      resources: resources(spec.resources),
      restart: {
        condition: spec.restart.condition,
        delayMs: spec.restart.delayMs,
        ...(spec.restart.maxAttempts ? { maxAttempts: spec.restart.maxAttempts } : {}),
      },
      placement: placement.nodeId ? { nodes: [placement.nodeId] } : {},
    },
    endpoint: {
      ports: spec.ports.map((p) => ({
        protocol: p.protocol,
        targetPort: p.containerPort,
        publish: "internal",
      })),
      aliases,
      scopes: [`${spec.projectSlug}${spec.networkScopeSuffix ?? ""}`],
    },
    lifecycle: placement.nodeId ? { failoverPolicy: "stay" } : {},
  });
}

/** A database as an otterd ServiceSpec: one exclusive slot on its volume. */
export function databaseToSpec(
  input: DatabaseSpec,
  placement: Placement,
): Result<ServiceSpec, TranslateRefusal> {
  const adapter = getEngineAdapter(input.engine);
  const image = input.image ?? adapter.defaultImage;
  const mount = resolveDatabaseMount(adapter, image);
  const user = Object.entries(input.extraEnv ?? {}).filter(
    ([k]) => !adapter.reservedEnvKeys.has(k),
  );
  const identity = adapter.buildEnv({
    username: input.username,
    password: input.password,
    databaseName: input.databaseName,
  });
  const env = Object.fromEntries([
    ...user,
    ...[...identity, ...mount.env].map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)] as const;
    }),
  ]);
  const command = adapter.buildCommand?.({ password: input.password });
  return finish({
    resourceId: input.resourceId,
    mode: { kind: "replicated", replicas: 1 },
    task: {
      container: {
        image: { reference: image },
        ...(command ? { args: command } : {}),
        env: literalEnv(env),
        hostname: input.hostnameAlias,
        labels: {
          "otterdeploy.managed": "true",
          "otterdeploy.resource.type": input.engine,
          "otterdeploy.resource.id": input.resourceId,
          "otterdeploy.project": input.projectSlug,
          "otterdeploy.deployment.id": input.deploymentId,
        },
      },
      mounts: [{ kind: "volume", source: input.volumeName, target: mount.target }],
      restart: { condition: "on-failure", delayMs: 5_000, maxAttempts: 5 },
      placement: placement.nodeId ? { nodes: [placement.nodeId] } : {},
    },
    endpoint: {
      aliases: [input.serviceName, input.hostnameAlias],
      scopes: [`${input.projectSlug}${input.networkScopeSuffix ?? ""}`],
    },
    lifecycle: { exclusive: true, failoverPolicy: "stay" },
  });
}
