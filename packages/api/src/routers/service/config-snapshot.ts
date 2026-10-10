/**
 * The runtime config a deployment ran with, recorded on its row so a rollback
 * can put it back together with the image.
 *
 * A source deploy applies the manifest first and builds second: a push that
 * changes the port lands the new port on the service row before its build
 * runs, and when that build fails the row keeps it. Rolling back only the
 * image then health-checks the last good image on the broken push's port, and
 * it never becomes ready. So the config that is tied to the image (what it
 * listens on, how it is health-checked, how it starts) is snapshotted when a
 * deployment rolls out, and restored with the image. Env is not: a rollback
 * keeps today's env (an old env may reference deleted resources).
 */
import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

import { db } from "@otterdeploy/db";
import { deployment, serviceResource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import * as z from "zod";

import type { ServicePortRow, ServiceResourceRow } from "./queries";

import { listServicePorts, replaceServicePorts } from "./queries";

const nullableInt = z.number().int().nullable();

const serviceConfigSnapshotSchema = z.object({
  ports: z.array(
    z.object({
      containerPort: z.number().int().positive(),
      protocol: z.enum(["tcp", "udp"]),
      appProtocol: z.enum(["http", "tcp"]),
      isPrimary: z.boolean(),
    }),
  ),
  healthcheck: z.object({
    cmd: z.array(z.string()).nullable(),
    intervalMs: nullableInt,
    timeoutMs: nullableInt,
    retries: nullableInt,
    startMs: nullableInt,
  }),
  command: z.array(z.string()).nullable(),
  entrypoint: z.array(z.string()).nullable(),
});

export type ServiceConfigSnapshot = z.infer<typeof serviceConfigSnapshotSchema>;

/** The key the config lives under in `deployment.snapshot`. */
const CONFIG_KEY = "config";

/** The image-bound config of a service as its rows hold it now. */
function serviceConfigOf(
  service: Pick<
    ServiceResourceRow,
    | "healthcheckCmd"
    | "healthcheckIntervalMs"
    | "healthcheckTimeoutMs"
    | "healthcheckRetries"
    | "healthcheckStartMs"
    | "command"
    | "entrypoint"
  >,
  ports: Pick<ServicePortRow, "containerPort" | "protocol" | "appProtocol" | "isPrimary">[],
): ServiceConfigSnapshot {
  return {
    ports: ports
      .map((p) => ({
        containerPort: p.containerPort,
        protocol: p.protocol,
        appProtocol: p.appProtocol,
        isPrimary: p.isPrimary,
      }))
      .sort((a, b) => a.containerPort - b.containerPort),
    healthcheck: {
      cmd: service.healthcheckCmd,
      intervalMs: service.healthcheckIntervalMs,
      timeoutMs: service.healthcheckTimeoutMs,
      retries: service.healthcheckRetries,
      startMs: service.healthcheckStartMs,
    },
    command: service.command,
    entrypoint: service.entrypoint,
  };
}

/** Read the service's current image-bound config; null when it is gone. */
export async function readServiceConfig(
  resourceId: ResourceId,
): Promise<ServiceConfigSnapshot | null> {
  const [service] = await db
    .select()
    .from(serviceResource)
    .where(eq(serviceResource.resourceId, resourceId))
    .limit(1)
    .$withCache(false);
  if (!service) return null;
  return serviceConfigOf(service, await listServicePorts(resourceId));
}

/** The config a deployment row recorded, or null for a row that has none
 *  (rows from before this snapshot existed, databases, stacks). */
export function configFromSnapshot(snapshot: JsonObject): ServiceConfigSnapshot | null {
  const parsed = serviceConfigSnapshotSchema.safeParse(snapshot[CONFIG_KEY]);
  return parsed.success ? parsed.data : null;
}

/** A snapshot object carrying `config`, for a row being inserted. */
export function snapshotWithConfig(
  snapshot: JsonObject,
  config: ServiceConfigSnapshot | null,
): JsonObject {
  return config ? { ...snapshot, [CONFIG_KEY]: config } : snapshot;
}

/**
 * Record on the deployment the config the service is about to roll out with.
 * Called right before the rollout, so it is the config the runtime got, not
 * whatever a later apply wrote.
 */
export async function recordDeploymentConfig(
  deploymentId: DeploymentId,
  resourceId: ResourceId,
): Promise<void> {
  const config = await readServiceConfig(resourceId);
  if (!config) return;
  const [row] = await db
    .select({ snapshot: deployment.snapshot })
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .limit(1)
    .$withCache(false);
  if (!row) return;
  await db
    .update(deployment)
    .set({ snapshot: snapshotWithConfig(row.snapshot, config) })
    .where(eq(deployment.id, deploymentId));
}

/** Write a recorded config back onto the service's rows. */
export async function restoreServiceConfig(
  resourceId: ResourceId,
  config: ServiceConfigSnapshot,
): Promise<void> {
  await db
    .update(serviceResource)
    .set({
      healthcheckCmd: config.healthcheck.cmd,
      healthcheckIntervalMs: config.healthcheck.intervalMs,
      healthcheckTimeoutMs: config.healthcheck.timeoutMs,
      healthcheckRetries: config.healthcheck.retries,
      healthcheckStartMs: config.healthcheck.startMs,
      command: config.command,
      entrypoint: config.entrypoint,
    })
    .where(eq(serviceResource.resourceId, resourceId));
  await replaceServicePorts(resourceId, config.ports);
}
