/**
 * Pass 2 of a stack reconcile: roll out the service rows pass 1 materialized.
 *
 * Split from reconcile.ts so the two passes are separable — and because the
 * split itself is load-bearing: `${{stack.<svc>.HOST}}` resolves against a
 * SIBLING'S row while THIS service deploys, so every row in the stack has to
 * exist before any of them rolls out. Interleaving the two would make a
 * reference to a service defined later in the file fail on first deploy.
 *
 * Public exposure is seeded in that same pre-rollout pass, for the same
 * reason one step further: `${{stack.<svc>.PUBLIC_URL}}` answers from the
 * sibling's PROXY ROUTES, and `serviceExports` omits DOMAIN/PUBLIC_URL/DOMAINS
 * entirely when a service has none. Seeding exposure after the rollout (where
 * it used to live) meant the routes did not exist while env was resolving, so
 * a stack that points its own `MAIN_URL` at its public address failed its
 * FIRST deploy with an unknown-variable error and succeeded only on the
 * second. See [[seedServiceExposure]], called from reconcile.ts's pass 1.5.
 */
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { createLogger } from "evlog";

import type { ParsedComposeService } from "../../stack/compose";
import type { SwarmServiceRuntime } from "../../swarm";

import { insertDeployment, markDeploymentFailed } from "../project/deployments";
import { normalizePublicHostInput } from "../service/domain-rules";
import { exposeService } from "../service/expose";
import { getServiceRecord, setServicePublicDomain } from "../service/queries";
import { provisionFresh, redeployOne } from "../service/redeploy";
import { friendlyServiceCollisionMessage } from "./queries";

/**
 * The slice of the reconcile context a rollout reads. Declared structurally
 * rather than imported from ./reconcile, which imports THIS module: a
 * type-only edge is still an edge, and the repo's cycle ratchet counts it.
 * `StackReconcileContext` satisfies this by shape.
 */
export interface RolloutContext {
  projectId: ProjectId;
  organizationId: OrganizationId;
  projectSlug: string;
  stackResourceId: ResourceId;
  /** Compose-service name → seed domain ("" = generated host). See
   *  StackReconcileContext.exposedSeeds. */
  exposedSeeds: ReadonlyMap<string, string>;
}

/** One service that pass 1 committed a row for, ready to roll out. */
export interface MaterializedService {
  svc: ParsedComposeService;
  image: string;
  serviceName: string;
  resourceId: ResourceId;
  isCreate: boolean;
  /** The hostname the row actually carries, which is NOT always the bare
   *  compose key: see pickInternalHostname. The sibling-host rewrite reads it. */
  internalHostname: string;
}

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** User-facing failure line for one compose service: a friendly collision
 *  message when the throw is a DB unique-violation, else the raw error text. */
export function describeReconcileFailure(e: unknown, svcName: string): string {
  return friendlyServiceCollisionMessage(e, svcName) ?? toErrorMessage(e);
}

/**
 * Seed-only public exposure: the wizard/manifest's `exposed` selection
 * applies ONCE, the moment a compose service is first materialized as a real
 * service_resource: via the exact same `exposeService` primitive the
 * child's own Settings toggle calls, so it lands in the single per-service
 * source of truth instead of a stack-level shadow record. Callers only fire
 * this when `isCreate` is true, so it never re-fires on a later reconcile and
 * never undoes an operator's own expose/unexpose. Best-effort: an exposure
 * failure is logged to the deploy progress but never fails the service's
 * otherwise-successful rollout.
 */
export async function seedServiceExposure(
  ctx: RolloutContext,
  isCreate: boolean,
  svcName: string,
  resourceId: ResourceId,
  log: RequestLogger | undefined,
  progress: (line: string) => void,
): Promise<void> {
  if (!isCreate) return;
  const seedDomain = ctx.exposedSeeds.get(svcName);
  if (seedDomain === undefined) return;
  const seedLog = log ?? createLogger({ operation: "compose.seed-expose" });

  // The wizard/manifest named an explicit public domain for this service
  // (e.g. the template's edited address variable). Record it as the child's
  // own domain override BEFORE exposing: `exposeService` resolves the host
  // through that override, so the route is minted at exactly the domain the
  // operator chose instead of the name-derived generated one.
  if (seedDomain !== "") {
    const host = normalizePublicHostInput(seedDomain);
    if (host) {
      await setServicePublicDomain(resourceId, host);
    } else {
      progress(
        `Service ${svcName}: exposed domain "${seedDomain}" isn't a usable hostname; using the generated host instead.`,
      );
    }
  }
  const seeded = await Result.tryPromise({
    try: () =>
      exposeService(
        { projectId: ctx.projectId, organizationId: ctx.organizationId, resourceId },
        // Skip the "confirm the sslip.io fallback" prompt a manual toggle
        // would show. There's no operator present to answer it mid-rollout.
        true,
        seedLog,
      ),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });
  if (seeded.isErr()) {
    progress(`Service ${svcName}: seed expose failed, ${toErrorMessage(seeded.error)}`);
  } else if (seeded.value.isErr()) {
    progress(`Service ${svcName}: seed expose failed, ${seeded.value.error.message}`);
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
 * failure": the three-way outcome (threw / swarm reported error / running) is
 * the same shape for every service and doesn't need re-deciding per iteration.
 */
async function settleServiceRollout<E>(input: {
  deploymentId: DeploymentId;
  /** Generic in the error arm: the caller's rollout is `provisionFresh`,
   *  `redeployOne`, or a bare `Error` for a vanished row: all three settle
   *  identically, and only `toErrorMessage` ever touches the payload. */
  rolled: Result<SwarmServiceRuntime, E>;
  composeServiceName: string;
  progress: (line: string) => void;
}): Promise<boolean> {
  const { rolled, composeServiceName: svcName, progress } = input;
  if (rolled.isErr()) {
    const message = toErrorMessage(rolled.error);
    await markDeploymentFailed(input.deploymentId, message);
    progress(`Service ${svcName}: failed, ${message}`);
    return false;
  }
  if (rolled.value.status === "error") {
    // Prefer the swarm task's own failure reason (e.g. an image that can't
    // be pulled) over a generic "errored". That message is all the user
    // sees on a stack that never came up.
    const detail = rolled.value.errorMessage ?? "swarm reported an error state";
    await markDeploymentFailed(input.deploymentId, `${svcName}: ${detail}`);
    progress(`Service ${svcName}: failed, ${detail}`);
    return false;
  }
  await db
    .update(deployment)
    .set({ status: "running", completedAt: new Date() })
    .where(eq(deployment.id, input.deploymentId));
  progress(`Service ${svcName}: rolled out.`);
  return true;
}

/** Roll out every materialized service, in file order. Never throws: a
 *  service that fails is reported, and the rest still deploy. */
export async function rolloutMaterialized(input: {
  ctx: RolloutContext;
  materialized: ReadonlyArray<MaterializedService>;
  reason: "create" | "redeploy" | "env-change";
  progress: (line: string) => void;
  log?: RequestLogger;
}): Promise<{ deployed: number; failed: string[] }> {
  const { ctx, materialized, reason, progress, log } = input;
  const failed: string[] = [];
  let deployed = 0;

  for (const { svc, image, serviceName, resourceId, isCreate } of materialized) {
    // This service's own deployment row, once opened. Hoisted so the catch can
    // SETTLE it: an unsettled row sits at "pending" forever, and the graph
    // reads a stack member's pending row as "Building", so a stack whose
    // Deployments tab said FAILED six hours ago still showed a spinner. The
    // periodic reconciler can't save us either: it protects any row owned by an
    // in-flight deploy job, which this one is for as long as the stack deploy
    // runs. The code that opens the row owns closing it.
    let openDeploymentId: DeploymentId | null = null;
    try {
      // One deployment row per service per reconcile → its own build/deploy
      // history + logs. buildSwarmSpec stamps this (latest) deployment's id onto
      // the swarm tasks, so the Deployments tab groups tasks correctly. The
      // image is prebuilt/pulled (nothing compiles here) so the row starts at
      // "pending", not "building".
      const dep = await insertDeployment({
        resourceId,
        image,
        reason: isCreate ? "create" : reason === "create" ? "create" : "redeploy",
        status: "pending",
        snapshot: { stack: ctx.stackResourceId, composeService: svc.name },
      });
      openDeploymentId = dep.id;

      progress(
        `Service ${svc.name}: ${isCreate ? "creating" : "updating"} ${serviceName} from ${image}…`,
      );

      // Provision (fresh) or update (existing) the swarm service via the EXISTING
      // per-service primitive: same path a standalone service deploys through.
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
      // Settled either way; nothing left for the catch to close.
      openDeploymentId = null;
      if (!rolledOut) {
        failed.push(svc.name);
        continue;
      }
      deployed++;
    } catch (e) {
      const detail = describeReconcileFailure(e, svc.name);
      progress(`Service ${svc.name}: failed, ${detail}`);
      // Close this service's own row, so its card stops reading "Building".
      // Best-effort: a DB that just threw must not also abort the loop.
      if (openDeploymentId) {
        await markDeploymentFailed(openDeploymentId, detail).catch(() => undefined);
      }
      failed.push(svc.name);
    }
  }

  return { deployed, failed };
}
