/**
 * Materialize a compose stack's services as REAL `service_resource` rows owned
 * by the stack, then drive each through the normal per-service deploy path.
 *
 * Why: a compose service is a first-class resource — it has its own deployment
 * history, logs, terminal, variables, settings, and public/private toggle. By
 * making each compose service an actual `service_resource` (with `stackId` set),
 * every existing service feature works for it unchanged — no re-implementation.
 *
 * The compose file stays the STRUCTURAL source of truth: each deploy reconciles
 * the rows (create new, update existing spec, remove dropped). Per-service env
 * is seeded from the file on first create, then owned by the user (edits in the
 * Variables tab survive re-deploys). See docs/designs/compose.md.
 */
import { and, eq } from "drizzle-orm";
import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment, resource, serviceResource } from "@otterdeploy/db/schema/project";
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { PLATFORM } from "../../constants";
import { deleteProxyRoutesByResource } from "../../caddy/queries";
import {
  composeSwarmServiceName,
  durationMs,
  type ParsedCompose,
  type ParsedComposeService,
} from "../../stack/compose";
import { runtime } from "../../runtime";
import {
  insertDeployment,
  markDeploymentFailed,
} from "../project/deployments";
import { deleteResourceById } from "../project/queries";
import {
  createServiceRecord,
  getServiceRecord,
  updateServiceRecord,
  type CreateServiceInput,
} from "../service/queries";
import { provisionFresh, redeployOne } from "../service/redeploy";
import { sanitizeSlug } from "../service/views";
import { interpolate, substituteComposeEnv } from "./env";

export interface StackReconcileContext {
  projectId: ProjectId;
  /** The compose resource id — written as `service_resource.stackId`. */
  stackResourceId: ResourceId;
  projectSlug: string;
  stackName: string;
  /** Project env bag for `${VAR:-default}` interpolation. */
  projectVars: Record<string, string>;
  /** Built image tags for `build:` services (compose name → ref). */
  builtImages: Record<string, string>;
}

export interface StackReconcileResult {
  deployed: number;
  failed: string[];
}

const sanitize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Compose `restart:` → the service resource's restart condition enum. */
function toRestartCondition(
  r: ParsedComposeService["restart"],
): "none" | "on-failure" | "any" {
  if (r === "no") return "none";
  if (r === "on-failure") return "on-failure";
  return "any";
}

/** Compose healthcheck → the service resource's healthcheck columns. Mirrors
 *  `to-spec.ts#toHealthcheck`: strip compose's CMD/CMD-SHELL directive (the
 *  swarm provisioner re-adds CMD), shell form → `/bin/sh -c <cmd>`. */
function toHealthcheck(svc: ParsedComposeService): {
  healthcheckCmd: string[] | null;
  healthcheckIntervalMs: number | null;
  healthcheckTimeoutMs: number | null;
  healthcheckRetries: number | null;
  healthcheckStartMs: number | null;
} {
  const hc = svc.healthcheck;
  const none = {
    healthcheckCmd: null,
    healthcheckIntervalMs: null,
    healthcheckTimeoutMs: null,
    healthcheckRetries: null,
    healthcheckStartMs: null,
  };
  if (!hc || hc.disable || hc.test.length === 0) return none;
  const head = hc.test[0];
  if (head === "NONE") return none;
  let cmd: string[];
  if (head === "CMD") cmd = hc.test.slice(1);
  else if (head === "CMD-SHELL")
    cmd = ["/bin/sh", "-c", hc.test.slice(1).join(" ")];
  else cmd = hc.test;
  if (cmd.length === 0) return none;
  return {
    healthcheckCmd: cmd,
    healthcheckIntervalMs: durationMs(hc.interval) ?? 30_000,
    healthcheckTimeoutMs: durationMs(hc.timeout) ?? 5_000,
    healthcheckRetries: hc.retries ?? 3,
    healthcheckStartMs: durationMs(hc.startPeriod) ?? 0,
  };
}

/** Map a parsed compose service → the create/update shape for its service row.
 *  Image/command/entrypoint/env are interpolated against the project bag, so
 *  what we store + deploy is fully concrete (no `${VAR}` reaches swarm). */
function toServiceFields(
  svc: ParsedComposeService,
  ctx: StackReconcileContext,
  image: string,
): {
  serviceName: string;
  internalHostname: string;
  networkName: string;
  fields: Pick<
    CreateServiceInput,
    | "image"
    | "command"
    | "entrypoint"
    | "replicas"
    | "restartCondition"
    | "healthcheckCmd"
    | "healthcheckIntervalMs"
    | "healthcheckTimeoutMs"
    | "healthcheckRetries"
    | "healthcheckStartMs"
    | "cpuLimit"
    | "memoryLimitMb"
  >;
  ports: CreateServiceInput["ports"];
  env: Array<{ key: string; value: string }>;
} {
  const projectSlug = sanitizeSlug(ctx.projectSlug);
  // Interpolate compose env against the project bag, then flatten to the
  // {key,value} rows createServiceRecord seeds.
  const { env: resolvedEnv } = substituteComposeEnv(svc.env, ctx.projectVars);
  const env = Object.entries(resolvedEnv).map(([key, value]) => ({ key, value }));
  // First http-ish port (tcp) is the primary — the one a public domain fronts.
  const seenPorts = new Set<number>();
  let primaryAssigned = false;
  const ports: CreateServiceInput["ports"] = [];
  for (const p of svc.ports) {
    if (seenPorts.has(p.target)) continue;
    seenPorts.add(p.target);
    const appProtocol = p.protocol === "udp" ? ("tcp" as const) : ("http" as const);
    const isPrimary = !primaryAssigned && appProtocol === "http";
    if (isPrimary) primaryAssigned = true;
    ports.push({
      containerPort: p.target,
      protocol: p.protocol,
      appProtocol,
      isPrimary,
    });
  }
  return {
    serviceName: composeSwarmServiceName(ctx.stackName, svc.name),
    // Bare compose name = the overlay DNS alias intra-stack peers connect to.
    internalHostname: sanitize(svc.name),
    networkName: `${PLATFORM.swarm.networkPrefix}${projectSlug}`,
    fields: {
      image,
      command: svc.command?.map((c) => interpolate(c, ctx.projectVars)) ?? null,
      entrypoint:
        svc.entrypoint?.map((c) => interpolate(c, ctx.projectVars)) ?? null,
      replicas: svc.replicas,
      restartCondition: toRestartCondition(svc.restart),
      ...toHealthcheck(svc),
      cpuLimit: svc.resources.cpus ? String(svc.resources.cpus) : null,
      memoryLimitMb: svc.resources.memoryMb ?? null,
    },
    ports,
    env,
  };
}

/** Pick a project-unique resource name for a new stack service. Prefers the
 *  bare compose key (e.g. "web"); if another resource already owns that name,
 *  suffix until free. Matching on re-reconcile keys off serviceName, so a
 *  suffixed display name stays stable. */
async function pickResourceName(
  projectId: ProjectId,
  composeName: string,
): Promise<string> {
  const base = composeName.slice(0, 60);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [exists] = await db
      .select({ id: resource.id })
      .from(resource)
      .where(and(eq(resource.projectId, projectId), eq(resource.name, candidate)))
      .limit(1);
    if (!exists) return candidate;
  }
  // Extremely unlikely — fall back to a stack-scoped suffix.
  return `${base}-${composeName.length}`;
}

/**
 * Reconcile the stack's service rows + deploy each. Returns how many deployed
 * and which compose services failed to roll out.
 */
export async function reconcileStackServices(
  parsed: ParsedCompose,
  ctx: StackReconcileContext,
  reason: "create" | "redeploy" | "env-change",
  log?: RequestLogger,
): Promise<StackReconcileResult> {
  // Existing services already owned by this stack, keyed by swarm service name
  // (deterministic from stackName + compose key — stable across reconciles).
  const existingRows = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(eq(serviceResource.stackId, ctx.stackResourceId));
  const existingByName = new Map(
    existingRows.map((r) => [r.service.serviceName, r] as const),
  );

  const resolveImage = (svc: ParsedComposeService): string | null => {
    const raw = svc.image ?? ctx.builtImages[svc.name] ?? null;
    return raw ? interpolate(raw, ctx.projectVars) : null;
  };

  const desired = new Set<string>();
  const failed: string[] = [];
  let deployed = 0;

  for (const svc of parsed.services) {
    const image = resolveImage(svc);
    if (!image) {
      failed.push(svc.name);
      continue;
    }
    const mapped = toServiceFields(svc, ctx, image);
    desired.add(mapped.serviceName);

    const existing = existingByName.get(mapped.serviceName);
    let resourceId: ResourceId;
    let isCreate = false;

    if (existing) {
      resourceId = existing.resource.id;
      // Structure (image/command/replicas/healthcheck/resources) tracks the
      // file. Env + ports + name are left alone — the user owns env post-create.
      await updateServiceRecord(resourceId, mapped.fields);
    } else {
      isCreate = true;
      const name = await pickResourceName(ctx.projectId, svc.name);
      const created = await createServiceRecord({
        projectId: ctx.projectId,
        name,
        status: "draft",
        source: "image",
        internalHostname: mapped.internalHostname,
        serviceName: mapped.serviceName,
        networkName: mapped.networkName,
        stackId: ctx.stackResourceId,
        ports: mapped.ports,
        env: mapped.env,
        ...mapped.fields,
      });
      resourceId = created.resource.id;
    }

    // One deployment row per service per reconcile → its own build/deploy
    // history + logs. buildSwarmSpec stamps this (latest) deployment's id onto
    // the swarm tasks, so the Deployments tab groups tasks correctly.
    const dep = await insertDeployment({
      resourceId,
      image,
      reason: isCreate ? "create" : reason === "create" ? "create" : "redeploy",
      snapshot: { stack: ctx.stackResourceId, composeService: svc.name },
    });

    // Provision (fresh) or update (existing) the swarm service via the EXISTING
    // per-service primitive — same path a standalone service deploys through.
    const rolled = isCreate
      ? await (async () => {
          const record = await getServiceRecord(ctx.projectId, resourceId);
          if (!record)
            return Result.err(new Error("Service row vanished after create"));
          return provisionFresh(ctx.projectId, record, ctx.projectSlug, log);
        })()
      : await redeployOne(ctx.projectId, resourceId, ctx.projectSlug, log);

    if (rolled.isErr()) {
      await markDeploymentFailed(
        dep.id,
        rolled.error instanceof Error ? rolled.error.message : String(rolled.error),
      );
      failed.push(svc.name);
      continue;
    }
    if (rolled.value.status === "error") {
      await markDeploymentFailed(dep.id, `Swarm reported ${svc.name} errored`);
      failed.push(svc.name);
      continue;
    }
    await db
      .update(deployment)
      .set({ status: "running", completedAt: new Date() })
      .where(eq(deployment.id, dep.id));
    deployed++;
  }

  // Remove services the file no longer declares: tear down swarm + routes +
  // the resource row (cascade-drops its sidecar/env/ports/deployments).
  for (const [serviceName, row] of existingByName) {
    if (desired.has(serviceName)) continue;
    await Result.tryPromise({
      try: () => runtime().destroy({ serviceName }, log),
      catch: (e) => e,
    });
    await deleteProxyRoutesByResource(row.resource.id);
    await deleteResourceById(row.resource.id);
  }

  return { deployed, failed };
}

/**
 * Tear down every service owned by a stack — used on stack delete. Destroys
 * each swarm service + drops its routes + resource row.
 */
export async function removeStackServices(
  stackResourceId: ResourceId,
  log?: RequestLogger,
): Promise<void> {
  const rows = await db
    .select({ resourceId: resource.id, serviceName: serviceResource.serviceName })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(eq(serviceResource.stackId, stackResourceId));
  for (const row of rows) {
    await Result.tryPromise({
      try: () => runtime().destroy({ serviceName: row.serviceName }, log),
      catch: (e) => e,
    });
    await deleteProxyRoutesByResource(row.resourceId);
    await deleteResourceById(row.resourceId);
  }
}
