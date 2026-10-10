/**
 * Rollback for the Service primitive. Split out of handlers.ts to keep that
 * file under the line cap; re-exported from there so the router import path is
 * unchanged.
 */
import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";

import type { ProjectNotFoundError } from "../project/errors";

import {
  type DeploymentRow,
  getResourceDeploymentById,
  markDeploymentFailed,
  markDeploymentRunning,
} from "../project/deployments";
import { emitDeployStarted } from "../project/deployments-emit";
import { publishResourceChanged } from "../project/project-event-bus";
import {
  configFromSnapshot,
  readServiceConfig,
  restoreServiceConfig,
  snapshotWithConfig,
} from "./config-snapshot";
import { loadResource } from "./context";
import {
  NotRollbackableError,
  RollbackFailedError,
  ServiceNotFoundError,
  type ResolveError,
} from "./errors";
import { getService } from "./handlers";
import { type ResourceRef } from "./inputs";
import { redeployAndFanOut } from "./redeploy";
import { type ServiceView } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;
type RedeployFailure = NotFound | ResolveError;

/** How long an unsettled rollback row blocks the next one. Longer than any
 *  real roll (pull + the readiness window); a row older than this was left
 *  behind by a process that died mid-roll, and must not block recovery. */
const INFLIGHT_ROLLBACK_WINDOW = sql`now() - interval '15 minutes'`;

type ClaimedRow = Pick<DeploymentRow, "id">;

/**
 * Open the rollback's deployment row, or name the rollback already rolling.
 *
 * One rollback per service at a time: two at once (a double tap
 * on a phone, a retry after a slow answer) ran two health-gated cutovers of
 * the same container, and one died on "removal of container … is already in
 * progress". The resource row is locked first so the second request reads the
 * first one's row. Never from the query cache: a cached read takes no lock.
 */
async function claimRollbackRow(
  resourceId: ResourceId,
  values: typeof deployment.$inferInsert,
): Promise<{ ok: true; row: ClaimedRow } | { ok: false; inflight: DeploymentId | null }> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: resource.id })
      .from(resource)
      .where(eq(resource.id, resourceId))
      .for("no key update")
      .$withCache(false);
    const [inflight] = await tx
      .select({ id: deployment.id })
      .from(deployment)
      .where(
        and(
          eq(deployment.resourceId, resourceId),
          eq(deployment.reason, "rollback"),
          inArray(deployment.status, ["pending", "building"]),
          gt(deployment.createdAt, INFLIGHT_ROLLBACK_WINDOW),
        ),
      )
      .orderBy(desc(deployment.createdAt))
      .limit(1)
      .$withCache(false);
    if (inflight) return { ok: false, inflight: inflight.id };
    const [row] = await tx.insert(deployment).values(values).returning({ id: deployment.id });
    return row ? { ok: true, row } : { ok: false, inflight: null };
  });
}

/**
 * Roll a service back to a prior deployment: its image, and the image-bound
 * config it ran with (ports, health check, command; see ./config-snapshot.ts).
 * Without the config, a push that changed the port and then failed its build
 * left the port changed, and the last good image was health-checked on a port
 * it never listens on: the rollback could not recover the service. Env is
 * today's (you want the old code with today's config, not an old env that may
 * reference deleted resources). A target recorded before config snapshots
 * existed rolls the image only. The roll is recorded as a new
 * `reason:"rollback"` deployment so it shows in history and can itself be
 * rolled back. The target must be a settled deploy with a real (non-`pending:`)
 * image.
 */
export async function rollbackService(
  input: ResourceRef & { deploymentId: DeploymentId },
  log: RequestLogger,
): Promise<Result<ServiceView, RedeployFailure | NotRollbackableError | RollbackFailedError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const target = await getResourceDeploymentById(input.resourceId, input.deploymentId);
  if (!target) {
    return Result.err(new ServiceNotFoundError({ resourceId: input.resourceId }));
  }
  if (target.status !== "running" && target.status !== "superseded") {
    return Result.err(
      new NotRollbackableError({
        resourceId: input.resourceId,
        reason: `deployment is ${target.status}, not a settled successful deploy`,
      }),
    );
  }
  if (!target.image || target.image.startsWith("pending:")) {
    return Result.err(
      new NotRollbackableError({
        resourceId: input.resourceId,
        reason: "deployment has no built image",
      }),
    );
  }

  const previousImage = ctx.value.record.service.image;
  const targetConfig = configFromSnapshot(target.snapshot);
  const claimed = await claimRollbackRow(input.resourceId, {
    resourceId: input.resourceId,
    image: target.image,
    reason: "rollback",
    status: "building",
    // The config this roll runs with: the target's when it recorded one,
    // otherwise today's (which the image-only roll keeps). Either way the row
    // says what it rolled, so rolling back to IT later restores the same.
    snapshot: snapshotWithConfig(
      { rolledBackToDeploymentId: target.id, previousImage },
      targetConfig ?? (await readServiceConfig(input.resourceId)),
    ),
    // Inherit the target's commit: this deploy re-launches the image that was
    // built from it, so that commit is what the service is now running, and
    // it's what the deployment card should name.
    gitSha: target.gitSha,
    gitRef: target.gitRef,
    gitCommitMessage: target.gitCommitMessage,
    gitCommitAuthor: target.gitCommitAuthor,
    gitCommitAuthorAvatar: target.gitCommitAuthorAvatar,
  });
  if (!claimed.ok) {
    const reason = claimed.inflight
      ? `a rollback of this service is already rolling out (deployment ${claimed.inflight}); wait for it to settle`
      : "its deployment row could not be recorded";
    return Result.err(new NotRollbackableError({ resourceId: input.resourceId, reason }));
  }
  const row = claimed.row;
  await emitDeployStarted({
    deploymentId: row.id,
    resourceId: input.resourceId,
    reason: "rollback",
  });
  void publishResourceChanged(input.resourceId);

  // Pin by the target's tag; clear the digest (the deployment row stores no
  // digest, and the tag still resolves the rolled-back image).
  await db
    .update(serviceResource)
    .set({ image: target.image, imageDigest: null })
    .where(eq(serviceResource.resourceId, input.resourceId));
  if (targetConfig) await restoreServiceConfig(input.resourceId, targetConfig);

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) {
    await markDeploymentFailed(row.id, redeployed.error.message);
    return Result.err(redeployed.error);
  }
  // A roll that ended in error is a failed rollback, not a success with an
  // invalid service: the runtime is not running the target, so the row
  // must not read `running` and the caller must not read 200. That
  // includes a roll the runtime itself reverted to the previous version.
  const rolled = redeployed.value;
  if (rolled.status === "error") {
    const reason = rolled.errorMessage ?? "the runtime reported an error";
    await markDeploymentFailed(row.id, reason);
    return Result.err(
      new RollbackFailedError({ resourceId: input.resourceId, deploymentId: row.id, reason }),
    );
  }

  // Settles only a still-in-flight row: a cancel that landed during the roll
  // keeps the row cancelled.
  await markDeploymentRunning(row.id);

  return getService(input);
}
