import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
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
import { createLogger } from "evlog";

import type { SwarmServiceRuntime } from "../../swarm";

import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { runtime } from "../../runtime";
import {
  composeSwarmServiceName,
  type ParsedCompose,
  type ParsedComposeService,
} from "../../stack/compose";
import { insertDeployment, markDeploymentFailed } from "../project/deployments";
import { deleteResourceById } from "../project/queries";
import { exposeService } from "../service/expose";
import { getServiceRecord } from "../service/queries";
import { provisionFresh, redeployOne } from "../service/redeploy";
import { interpolate } from "./env";
import { friendlyServiceCollisionMessage } from "./queries";
import { toServiceFields } from "./reconcile-map";
import { materializeServiceRow } from "./reconcile-materialize";

export interface StackReconcileContext {
  projectId: ProjectId;
  /** Owning org — needed to seed public exposure via the same `exposeService`
   *  path a standalone service's Settings toggle calls. */
  organizationId: OrganizationId;
  /** Compose-service names (the file's `service:` key) to auto-expose the
   *  FIRST time each is materialized — the wizard/manifest's `exposed` seed.
   *  Seed only: applied once per service on create, never again, so an
   *  operator's later imperative expose/unexpose on the child's own Settings
   *  tab is the single source of truth from then on. */
  exposedSeedServiceNames: ReadonlySet<string>;
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
  /** Sink for human-readable progress lines on the STACK deployment's log
   *  (deployCompose wires this to the deployment_log writer). Optional so
   *  other callers stay unchanged. */
  deployLog?: (line: string) => void;
}

export interface StackReconcileResult {
  deployed: number;
  failed: string[];
}

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** User-facing failure line for one compose service: a friendly collision
 *  message when the throw is a DB unique-violation, else the raw error text. */
function describeReconcileFailure(e: unknown, svcName: string): string {
  return friendlyServiceCollisionMessage(e, svcName) ?? toErrorMessage(e);
}

/**
 * Seed-only public exposure: the wizard/manifest's `exposed` selection
 * applies ONCE, the moment a compose service is first materialized as a real
 * service_resource — via the exact same `exposeService` primitive the
 * child's own Settings toggle calls, so it lands in the single per-service
 * source of truth instead of a stack-level shadow record. Callers only fire
 * this when `isCreate` is true, so it never re-fires on a later reconcile and
 * never undoes an operator's own expose/unexpose. Best-effort: an exposure
 * failure is logged to the deploy progress but never fails the service's
 * otherwise-successful rollout.
 */
async function seedServiceExposure(
  ctx: StackReconcileContext,
  isCreate: boolean,
  svcName: string,
  resourceId: ResourceId,
  log: RequestLogger | undefined,
  progress: (line: string) => void,
): Promise<void> {
  if (!isCreate || !ctx.exposedSeedServiceNames.has(svcName)) return;
  const seedLog = log ?? createLogger({ operation: "compose.seed-expose" });
  const seeded = await Result.tryPromise({
    try: () =>
      exposeService(
        { projectId: ctx.projectId, organizationId: ctx.organizationId, resourceId },
        // Skip the "confirm the sslip.io fallback" prompt a manual toggle
        // would show — there's no operator present to answer it mid-rollout.
        true,
        seedLog,
      ),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });
  if (seeded.isErr()) {
    progress(`Service ${svcName}: seed expose failed — ${toErrorMessage(seeded.error)}`);
  } else if (seeded.value.isErr()) {
    progress(`Service ${svcName}: seed expose failed — ${seeded.value.error.message}`);
  } else {
    progress(
      `Service ${svcName}: exposed publicly at ${seeded.value.value.publicDomain ?? "generated host"}.`,
    );
  }
}

/**
 * Settle one service's deployment row from its rollout outcome and report
 * whether it came up. Returns `true` only for a service that actually reached
 * a running state; every failure path marks the deployment failed and writes
 * one operator-readable progress line first.
 *
 * Split out so the reconcile loop reads as "roll out, settle, continue on
 * failure" — the three-way outcome (threw / swarm reported error / running) is
 * the same shape for every service and doesn't need re-deciding per iteration.
 */
async function settleServiceRollout<E>(input: {
  deploymentId: DeploymentId;
  /** Generic in the error arm: the caller's rollout is `provisionFresh`,
   *  `redeployOne`, or a bare `Error` for a vanished row — all three settle
   *  identically, and only `toErrorMessage` ever touches the payload. */
  rolled: Result<SwarmServiceRuntime, E>;
  composeServiceName: string;
  progress: (line: string) => void;
}): Promise<boolean> {
  const { rolled, composeServiceName: svcName, progress } = input;
  if (rolled.isErr()) {
    const message = toErrorMessage(rolled.error);
    await markDeploymentFailed(input.deploymentId, message);
    progress(`Service ${svcName}: failed — ${message}`);
    return false;
  }
  if (rolled.value.status === "error") {
    // Prefer the swarm task's own failure reason (e.g. an image that can't
    // be pulled) over a generic "errored" — that message is all the user
    // sees on a stack that never came up.
    const detail = rolled.value.errorMessage ?? "swarm reported an error state";
    await markDeploymentFailed(input.deploymentId, `${svcName}: ${detail}`);
    progress(`Service ${svcName}: failed — ${detail}`);
    return false;
  }
  await db
    .update(deployment)
    .set({ status: "running", completedAt: new Date() })
    .where(eq(deployment.id, input.deploymentId));
  progress(`Service ${svcName}: rolled out.`);
  return true;
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

  // The stack's own environment. Children inherit it: an unstamped child is
  // visible only because MAIN additionally owns NULL rows (a legacy allowance
  // in inEnvironmentScope), so it would vanish from any non-main environment.
  const [stackRow] = await db
    .select({ environmentId: resource.environmentId })
    .from(resource)
    .where(eq(resource.id, ctx.stackResourceId))
    .limit(1);
  const environmentId = stackRow?.environmentId ?? null;

  const resolveImage = (svc: ParsedComposeService): string | null => {
    const raw = svc.image ?? ctx.builtImages[svc.name] ?? null;
    return raw ? interpolate(raw, ctx.projectVars) : null;
  };

  // Services the file DECLARES — the teardown loop below only removes rows NOT
  // in this set. Derive it from the parsed file, never from what deployed:
  // serviceName is image-independent (stackName + compose key), so a service
  // whose image can't resolve on a given reconcile (build not finished, a
  // transient pull miss) stays protected and is merely marked failed — it must
  // never be hard-deleted. Keying this off successful deploys is what let a
  // partial reconcile silently destroy stack members (4 services → 1).
  const desired = new Set<string>(
    parsed.services.map((svc) => composeSwarmServiceName(ctx.stackName, svc.name)),
  );
  const failed: string[] = [];
  let deployed = 0;
  const progress = ctx.deployLog ?? (() => undefined);

  for (const svc of parsed.services) {
    // Each service reconciles independently. A throw here (a failed
    // pickResourceName, createServiceRecord, insertDeployment, or a
    // buildSwarmSpec/provision that raises instead of returning an error) must
    // NOT abort the loop: earlier services (e.g. the stack's first "server")
    // are already committed, so an unguarded throw silently strands the whole
    // stack at its first member — the "4 services → only server" collapse.
    // Catch per service, record it as failed, and press on so every declared
    // service at least gets its resource row + a failure the operator can see.
    try {
      const image = resolveImage(svc);
      if (!image) {
        progress(`Service ${svc.name}: no image resolved (build not finished?) — skipped.`);
        failed.push(svc.name);
        continue;
      }
      const mapped = toServiceFields(svc, ctx, image);
      desired.add(mapped.serviceName);

      const { resourceId, isCreate } = await materializeServiceRow({
        ctx,
        composeServiceName: svc.name,
        mapped,
        existingResourceId: existingByName.get(mapped.serviceName)?.resource.id,
        environmentId,
      });

      // One deployment row per service per reconcile → its own build/deploy
      // history + logs. buildSwarmSpec stamps this (latest) deployment's id onto
      // the swarm tasks, so the Deployments tab groups tasks correctly. The
      // image is prebuilt/pulled — nothing compiles here — so the row starts at
      // "pending", not "building".
      const dep = await insertDeployment({
        resourceId,
        image,
        reason: isCreate ? "create" : reason === "create" ? "create" : "redeploy",
        status: "pending",
        snapshot: { stack: ctx.stackResourceId, composeService: svc.name },
      });

      progress(
        `Service ${svc.name}: ${isCreate ? "creating" : "updating"} ${mapped.serviceName} from ${image}…`,
      );

      // Provision (fresh) or update (existing) the swarm service via the EXISTING
      // per-service primitive — same path a standalone service deploys through.
      const rolled = isCreate
        ? await (async () => {
            const record = await getServiceRecord(ctx.projectId, resourceId);
            if (!record) return Result.err(new Error("Service row vanished after create"));
            return provisionFresh(ctx.projectId, record, ctx.projectSlug, log);
          })()
        : await redeployOne(ctx.projectId, resourceId, ctx.projectSlug, log);

      const rolledOut = await settleServiceRollout({
        deploymentId: dep.id,
        rolled,
        composeServiceName: svc.name,
        progress,
      });
      if (!rolledOut) {
        failed.push(svc.name);
        continue;
      }
      deployed++;

      await seedServiceExposure(ctx, isCreate, svc.name, resourceId, log, progress);
    } catch (e) {
      // A DB unique-violation (name / hostname / domain collision) otherwise
      // leaks the raw drizzle INSERT into the deploy log — map it to one line.
      progress(`Service ${svc.name}: failed — ${describeReconcileFailure(e, svc.name)}`);
      failed.push(svc.name);
    }
  }

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
