import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
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
import { eq } from "drizzle-orm";

import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { runtime } from "../../runtime";
import { type ParsedCompose, type ParsedComposeService } from "../../stack/compose";
import { insertDeployment, markDeploymentFailed } from "../project/deployments";
import { deleteResourceById } from "../project/queries";
import {
  bulkReplaceServiceMounts,
  createServiceRecord,
  getServiceRecord,
  updateServiceRecord,
} from "../service/queries";
import { provisionFresh, redeployOne } from "../service/redeploy";
import { interpolate } from "./env";
import { pickResourceName, toServiceFields } from "./reconcile-map";

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
  /** Materialized file-tree dir for a multi-file inline stack (absolute), where
   *  bind-mount sources resolve. Undefined for single-file / git stacks. */
  stackDir?: string;
}

export interface StackReconcileResult {
  deployed: number;
  failed: string[];
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
  const existingByName = new Map(existingRows.map((r) => [r.service.serviceName, r] as const));

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
      // Seed bind mounts (multi-file inline stacks) ONCE, on create — mirroring
      // the env "user owns it post-create" convention, so a later compose edit
      // never clobbers user-managed mounts and existing stacks are untouched.
      if (mapped.mounts.length > 0) {
        await bulkReplaceServiceMounts(resourceId, mapped.mounts);
      }
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
          if (!record) return Result.err(new Error("Service row vanished after create"));
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
