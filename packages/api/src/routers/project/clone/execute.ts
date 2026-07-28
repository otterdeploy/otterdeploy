/**
 * Execute a clone plan.
 *
 * What a clone deliberately does NOT copy, and why each one would be a bug:
 *
 *   domains — unique per install. Copying one would either collide on the
 *     unique index or, worse, hand the copy the live domain and let two
 *     services fight over the same hostname at the edge. Clones start with no
 *     domain; the operator adds or generates one when they want traffic.
 *
 *   volume data — node-local, and not ours to duplicate. The copy gets its own
 *     empty volumes under its own names. Reusing the source's volume name
 *     would give two services the same mount and corrupt both.
 *
 *   database passwords — regenerated. A clone that shares its source's
 *     credentials means one leaked password is two compromised databases, and
 *     rotating either breaks the other.
 *
 *   deployment history, runtime state — belongs to the original. A copy that
 *     inherits "deployed 3 minutes ago" is lying about something that never
 *     happened to it.
 *
 * Clones land as DRAFTS. Creating a resource is not the same as deciding to
 * run it, and a set of services that starts itself the moment it's copied is a
 * surprise — especially since env refs pointing outside the set (reported by
 * planClone) may still reach production.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { PLATFORM } from "../../../constants";
import { getEngineAdapter } from "../../../swarm/database-engines";
import { createServiceRecord, getServiceRecord } from "../../service/queries";
import { sanitizeSlug } from "../../service/views";
import { deriveInternalDbCredentials } from "../postgres/credentials";
import { createDatabaseResourceRecord } from "../queries/postgres-resource";
import { getDatabaseResourceRecord } from "../queries/postgres-resource";
import { type ClonePlan, rewriteRefs } from "./plan";

export interface CloneOutcome {
  /** Newly created resources, in plan order. */
  created: { resourceId: ResourceId; name: string; type: "service" | "database" }[];
  /** Sources that couldn't be cloned, with the reason. */
  failed: { sourceName: string; reason: string }[];
}

export async function executeClone(
  plan: ClonePlan,
  ctx: { projectId: ProjectId; projectSlug: string },
  log: RequestLogger,
): Promise<CloneOutcome> {
  const created: CloneOutcome["created"] = [];
  const failed: CloneOutcome["failed"] = [];

  for (const item of plan.items) {
    try {
      const service = await getServiceRecord(ctx.projectId, item.resourceId as ResourceId);
      if (service) {
        created.push(await cloneService(service, item.targetName, plan, ctx));
        continue;
      }
      const database = await getDatabaseResourceRecord(
        ctx.projectId,
        item.resourceId as ResourceId,
      );
      if (database) {
        created.push(await cloneDatabase(database, item.targetName, ctx));
        continue;
      }
      failed.push({ sourceName: item.sourceName, reason: "resource not found" });
    } catch (cause) {
      // One failure must not abandon the resources already created — they are
      // real rows the operator can see and delete. Record and continue.
      failed.push({
        sourceName: item.sourceName,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  log.set({
    clone: {
      requested: plan.items.length,
      created: created.length,
      failed: failed.length,
      externalRefs: plan.externalRefs.length,
    },
  });

  return { created, failed };
}

async function cloneService(
  record: Awaited<ReturnType<typeof getServiceRecord>> & object,
  targetName: string,
  plan: ClonePlan,
  ctx: { projectId: ProjectId; projectSlug: string },
): Promise<CloneOutcome["created"][number]> {
  const projectSlug = sanitizeSlug(ctx.projectSlug);
  const resourceSlug = sanitizeSlug(targetName);
  // Derived exactly as a fresh create derives them — the copy must be
  // indistinguishable from a service created under this name by hand.
  const serviceName = `${PLATFORM.service.serviceNamePrefix}${projectSlug}-${resourceSlug}`.slice(
    0,
    63,
  );

  const svc = record.service;
  const createdRecord = await createServiceRecord({
    projectId: ctx.projectId,
    name: targetName,
    status: "draft",
    image: svc.image,
    source: svc.source,
    sourceSubdir: svc.sourceSubdir,
    gitRepoId: svc.gitRepoId,
    branch: svc.branch,
    imageRepository: svc.imageRepository,
    previewsEnabled: svc.previewsEnabled,
    command: svc.command,
    entrypoint: svc.entrypoint,
    replicas: svc.replicas,
    restartCondition: svc.restartCondition,
    restartMaxAttempts: svc.restartMaxAttempts,
    restartDelayMs: svc.restartDelayMs,
    restartWindowMs: svc.restartWindowMs,
    healthcheckCmd: svc.healthcheckCmd,
    healthcheckIntervalMs: svc.healthcheckIntervalMs,
    healthcheckTimeoutMs: svc.healthcheckTimeoutMs,
    healthcheckRetries: svc.healthcheckRetries,
    healthcheckStartMs: svc.healthcheckStartMs,
    cpuLimit: svc.cpuLimit,
    memoryLimitMb: svc.memoryLimitMb,
    cpuReservation: svc.cpuReservation,
    memoryReservationMb: svc.memoryReservationMb,
    diskLimitMb: svc.diskLimitMb,
    swapLimitMb: svc.swapLimitMb,
    pidsLimit: svc.pidsLimit,
    preDeploy: svc.preDeploy,
    postDeploy: svc.postDeploy,
    buildConfig: svc.buildConfig,
    internalHostname: resourceSlug,
    serviceName,
    networkName: `${PLATFORM.swarm.networkPrefix}${projectSlug}`,
    ports: record.ports.map((p) => ({
      containerPort: p.containerPort,
      protocol: p.protocol,
      appProtocol: p.appProtocol,
      isPrimary: p.isPrimary,
    })),
    // The reason this module exists: refs to resources inside the set are
    // repointed at their copies. Left verbatim, the clone would read and WRITE
    // to the original's database while looking perfectly healthy.
    env: record.env.map((e) => ({
      key: e.key,
      value: rewriteRefs(e.value, plan.rename).value,
    })),
  });

  // Placement is copied: a set cloned onto one machine should land together,
  // and an operator who pinned the original meant something by it.
  if (record.resource.placementServerId) {
    await db
      .update(resource)
      .set({ placementServerId: record.resource.placementServerId })
      .where(eq(resource.id, createdRecord.resource.id));
  }

  return {
    resourceId: createdRecord.resource.id,
    name: targetName,
    type: "service",
  };
}

async function cloneDatabase(
  record: NonNullable<Awaited<ReturnType<typeof getDatabaseResourceRecord>>>,
  targetName: string,
  ctx: { projectId: ProjectId; projectSlug: string },
): Promise<CloneOutcome["created"][number]> {
  // A fresh password, never the source's. Sharing credentials means one leak
  // compromises both, and rotating either breaks the other.
  const password = randomBytes(18).toString("base64url");

  // Identity is DERIVED from the new name, never copied: the database name,
  // user, and internal hostname all encode which resource they belong to, and
  // a copy carrying the source's identity would answer to the source's DNS
  // alias on the project network — two engines, one hostname, requests split
  // between them at random.
  const adapter = getEngineAdapter(record.database.engine);
  const creds = deriveInternalDbCredentials({
    engine: record.database.engine,
    projectSlug: ctx.projectSlug,
    resourceName: targetName,
    password,
  });

  const createdRecord = await createDatabaseResourceRecord({
    projectId: ctx.projectId,
    name: targetName,
    engine: record.database.engine,
    status: "draft",
    databaseName: creds.databaseName,
    username: creds.username,
    password: creds.password,
    internalHostname: creds.internalHostname,
    internalPort: adapter.port,
    internalConnectionString: creds.internalConnectionString,
    upstreamHost: creds.internalHostname,
    upstreamPort: adapter.port,
    caddyLayer4Snippet: "",
    // Public exposure is opt-in per resource. A copy that publishes itself
    // because the original was public is a surprise with a hostname attached —
    // so the public fields exist but stay dark until the operator asks.
    publicEnabled: false,
    publicHostname: "",
    publicPort: PLATFORM.database.publicPort,
    publicConnectionString: "",
    // Config the operator chose carries over; identity and secrets do not.
    extraEnv: record.database.extraEnv ?? {},
    extensions: record.database.extensions ?? [],
  });

  if (record.resource.placementServerId) {
    await db
      .update(resource)
      .set({ placementServerId: record.resource.placementServerId })
      .where(eq(resource.id, createdRecord.resource.id));
  }

  return {
    resourceId: createdRecord.resource.id,
    name: targetName,
    type: "database",
  };
}
