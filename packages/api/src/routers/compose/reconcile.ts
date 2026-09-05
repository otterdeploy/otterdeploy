import type { EnvironmentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
/**
 * Materialize a compose stack's services as REAL `service_resource` rows owned
 * by the stack, then drive each through the normal per-service deploy path.
 *
 * Why: a compose service is a first-class resource. It has its own deployment
 * history, logs, terminal, variables, settings, and public/private toggle. By
 * making each compose service an actual `service_resource` (with `stackId` set),
 * every existing service feature works for it unchanged, no re-implementation.
 *
 * The compose file stays the STRUCTURAL source of truth: each deploy reconciles
 * the rows (create new, update existing spec, remove dropped). Per-service env
 * is seeded from the file on first create, then owned by the user (edits in the
 * Variables tab survive re-deploys). See docs/designs/compose.md.
 */
import { eq } from "drizzle-orm";

import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { runtime } from "../../runtime";
import {
  composeSwarmServiceName,
  type ParsedCompose,
  type ParsedComposeService,
} from "../../stack/compose";
import { deleteResourceById } from "../project/queries";
import { interpolate } from "./env";
import { toServiceFields } from "./reconcile-map";
import { materializeServiceRow } from "./reconcile-materialize";
import {
  describeReconcileFailure,
  rolloutMaterialized,
  seedServiceExposure,
  type MaterializedService,
} from "./reconcile-rollout";
import { rewriteSeededSiblingHosts } from "./reconcile-sibling-env";

export interface StackReconcileContext {
  projectId: ProjectId;
  /** Owning org, needed to seed public exposure via the same `exposeService`
   *  path a standalone service's Settings toggle calls. */
  organizationId: OrganizationId;
  /** Compose services (keyed by the file's `service:` key) to auto-expose the
   *  FIRST time each is materialized, mapped to the public domain the seed
   *  names for it ("" = mint the generated host). The wizard/manifest's
   *  `exposed` seed. Seed only: applied once per service on create, never
   *  again, so an operator's later imperative expose/unexpose on the child's
   *  own Settings tab is the single source of truth from then on. */
  exposedSeeds: ReadonlyMap<string, string>;
  /** The manifest's per-child env (`composes[stack].services[key].env`),
   *  keyed by compose service key. Layered OVER the compose file's own env
   *  when a child is first materialized, so a stack restored from its manifest
   *  comes back with the env an operator set on it (od-uhot). Seed only, like
   *  `exposedSeeds`: env is the operator's once the child exists. */
  manifestServiceEnv?: ReadonlyMap<string, Record<string, string>>;
  /** The compose resource id: written as `service_resource.stackId`. */
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
  /** Sink for human-readable progress lines on the STACK deployment's log
   *  (deployCompose wires this to the deployment_log writer). Optional so
   *  other callers stay unchanged. */
  deployLog?: (line: string) => void;
}

export interface StackReconcileResult {
  deployed: number;
  failed: string[];
}

/**
 * Reconcile the stack's service rows + deploy each. Returns how many deployed
 * and which compose services failed to roll out.
 */
/**
 * The two facts every child inherits from its stack: which environment it
 * belongs to, and the name it is namespaced under. Read from the stack row
 * rather than threaded through StackReconcileContext, so they cannot go
 * missing on one of the several construction paths.
 */
async function loadStackIdentity(
  ctx: StackReconcileContext,
): Promise<{ environmentId: EnvironmentId | null; stackResourceName: string }> {
  const [row] = await db
    .select({ environmentId: resource.environmentId, name: resource.name })
    .from(resource)
    .where(eq(resource.id, ctx.stackResourceId))
    .limit(1);
  return {
    environmentId: row?.environmentId ?? null,
    // The stack's RESOURCE name (`authentik`), not its swarm name.
    stackResourceName: row?.name ?? ctx.stackName,
  };
}

export async function reconcileStackServices(
  parsed: ParsedCompose,
  ctx: StackReconcileContext,
  reason: "create" | "redeploy" | "env-change",
  log?: RequestLogger,
): Promise<StackReconcileResult> {
  // Existing services already owned by this stack, keyed by swarm service name
  // (deterministic from stackName + compose key, stable across reconciles).
  const existingRows = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(eq(serviceResource.stackId, ctx.stackResourceId));
  const existingByName = new Map(existingRows.map((r) => [r.service.serviceName, r] as const));

  // The stack's own environment. Children inherit it: an unstamped child is
  // visible only because MAIN additionally owns NULL rows (a legacy allowance
  // in inEnvironmentScope), so it would vanish from any non-main environment.
  const { environmentId, stackResourceName } = await loadStackIdentity(ctx);

  const resolveImage = (svc: ParsedComposeService): string | null => {
    const raw = svc.image ?? ctx.builtImages[svc.name] ?? null;
    return raw ? interpolate(raw, ctx.projectVars) : null;
  };

  // Services the file DECLARES: the teardown loop below only removes rows NOT
  // in this set. Derive it from the parsed file, never from what deployed:
  // serviceName is image-independent (stackName + compose key), so a service
  // whose image can't resolve on a given reconcile (build not finished, a
  // transient pull miss) stays protected and is merely marked failed. It must
  // never be hard-deleted. Keying this off successful deploys is what let a
  // partial reconcile silently destroy stack members (4 services → 1).
  const desired = new Set<string>(
    parsed.services.map((svc) => composeSwarmServiceName(ctx.stackName, svc.name)),
  );
  const failed: string[] = [];
  let deployed = 0;
  const progress = ctx.deployLog ?? (() => undefined);

  // ── Pass 1: every service's ROW, before anything deploys.
  //
  // Deploying resolves that service's env, and `${{stack.<svc>.HOST}}` reads
  // the sibling's row to answer. Materializing and deploying in one pass would
  // therefore resolve a stack ref against a sibling that does not exist yet:
  // every reference pointing "down" the file fails on a stack's FIRST deploy,
  // and the file's authoring order silently becomes part of the contract
  // (`app` before `db` — how compose files are normally written — being the
  // broken case). One pass to make the whole stack visible, then one to roll
  // it out.
  const materialized: MaterializedService[] = [];

  for (const svc of parsed.services) {
    // Each service reconciles independently. A throw here (a failed
    // pickResourceName or createServiceRecord) must NOT abort the loop:
    // earlier services are already committed, so an unguarded throw silently
    // strands the whole stack at its first member: the "4 services → only
    // server" collapse. Catch per service, record it as failed, and press on
    // so every declared service at least gets a failure the operator can see.
    try {
      const image = resolveImage(svc);
      if (!image) {
        progress(`Service ${svc.name}: no image resolved (build not finished?). Skipped.`);
        failed.push(svc.name);
        continue;
      }
      const mapped = toServiceFields(svc, ctx, image);
      desired.add(mapped.serviceName);

      const existing = existingByName.get(mapped.serviceName);
      const { resourceId, isCreate, internalHostname } = await materializeServiceRow({
        ctx,
        composeServiceName: svc.name,
        mapped,
        existingResourceId: existing?.resource.id,
        existingInternalHostname: existing?.service.internalHostname,
        environmentId,
        stackResourceName,
      });
      materialized.push({
        svc,
        image,
        serviceName: mapped.serviceName,
        resourceId,
        isCreate,
        internalHostname,
      });
    } catch (e) {
      // A DB unique-violation (name / hostname collision) otherwise leaks the
      // raw drizzle INSERT into the deploy log. Map it to one line.
      const detail = describeReconcileFailure(e, svc.name);
      progress(`Service ${svc.name}: failed, ${detail}`);
      failed.push(svc.name);
    }
  }

  // ── Pass 1.4: repoint seeded env at the siblings it meant.
  //
  // A compose file addresses peers by bare service key, but the project network
  // is shared and `pickInternalHostname` renames a child whose bare name is
  // already taken. The seeded env still said `db`, and on a shared network that
  // name resolves — to the stack that got there first. See sibling-hosts.ts;
  // this is the pass that stops one stack reading another's data.
  //
  // Here, not inside materialize, because the map is only complete once every
  // row exists: each hostname is picked against the DB as it goes.
  const rewritten = await Result.tryPromise({
    try: () =>
      rewriteSeededSiblingHosts(
        materialized.map((m) => ({
          composeService: m.svc.name,
          internalHostname: m.internalHostname,
          resourceId: m.resourceId,
          isCreate: m.isCreate,
        })),
        log,
      ),
    catch: (e) => e,
  });
  if (rewritten.isOk() && rewritten.value > 0) {
    progress(`Repointed ${rewritten.value} variable(s) at renamed stack siblings.`);
  }

  // ── Pass 1.5: every new service's PUBLIC ROUTE, before anything deploys.
  //
  // Same argument as the pass 1/pass 2 split, one step further out.
  // `${{stack.<svc>.PUBLIC_URL}}` (and DOMAIN / DOMAINS) answer from the
  // sibling's proxy_route rows, and `serviceExports` OMITS those keys —
  // deliberately, rather than emitting a blank — while a service has no route.
  // Exposure used to be seeded after each service rolled out, so on a stack's
  // first deploy the routes did not exist yet while env was resolving: a stack
  // that addresses its own public URL (the normal shape for a self-hosted app
  // that has to know the hostname it serves) failed with an unknown-variable
  // error and only came up on a second, manual deploy. Route first, then roll.
  // Best-effort per service: seeding a route is not worth failing a rollout
  // over, and a throw here would strand every service after it in the file.
  for (const { svc, resourceId, isCreate } of materialized) {
    const seeded = await Result.tryPromise({
      try: () =>
        seedServiceExposure(ctx, isCreate, svc.name, resourceId, svc.labels, log, progress),
      catch: (e) => e,
    });
    if (seeded.isErr()) {
      progress(
        `Service ${svc.name}: seed expose failed, ${describeReconcileFailure(seeded.error, svc.name)}`,
      );
    }
  }

  const rollout = await rolloutMaterialized({
    ctx,
    materialized,
    reason,
    progress,
    log,
  });
  deployed += rollout.deployed;
  failed.push(...rollout.failed);

  // Remove services the file no longer declares: tear down swarm + routes +
  // the resource row (cascade-drops its sidecar/env/ports/deployments).
  for (const [serviceName, row] of existingByName) {
    if (desired.has(serviceName)) continue;
    progress(`Service ${serviceName}: removed (no longer in the compose file).`);
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
 * Tear down every service owned by a stack. Used on stack delete. Destroys
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
