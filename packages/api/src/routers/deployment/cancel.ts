/**
 * Cancel an in-flight deployment.
 *
 * A build runs in a throwaway helper container the builder spawns as
 * `otterbuild-<deploymentId>` (apps/builder/src/handler.ts), driving the HOST
 * docker daemon. The control plane talks to that same daemon, so cancelling
 * does not need a new cross-process channel: the container name is
 * deterministic, and removing it is exactly what the builder's own timeout path
 * already does at the 45-minute wall.
 *
 * Order matters, and is the subtle part. The row is written to `cancelled`
 * BEFORE the container is killed:
 *
 *   - killing first makes the helper exit non-zero while the row still reads
 *     `building`, which is precisely the "helper died before converging the
 *     row" "shape the builder retries (MAX_ATTEMPTS = 2). It would relaunch the
 *     build we just cancelled.
 *   - writing first means the builder's post-exit status read sees `cancelled`
 *     and stops, because a human stopping a build is not a crash to recover
 *     from.
 *
 * A deployment still sitting in the queue has no container yet; removing the
 * BullMQ job is what stops it. One job can carry several deploymentIds (a
 * compose stack, a multi-service apply), so the job is only removed when this
 * deployment is the only thing it owns — otherwise cancelling one service would
 * silently cancel its siblings.
 */

import type { DeploymentId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, project, resource } from "@otterdeploy/db/schema/project";
import { deployTriggeredJob, getQueue } from "@otterdeploy/jobs";
import { Result, TaggedError } from "better-result";
import { and, eq } from "drizzle-orm";

import { docker } from "../docker/client";
import { publishResourceChanged } from "../project/project-event-bus";

/** Not found, or not in this org — indistinguishable to the caller by design,
 *  so a cancel probe can never confirm a foreign deployment exists. */
class DeploymentNotFoundError extends TaggedError("DeploymentNotFoundError")<{
  message: string;
  deploymentId: DeploymentId;
}>() {
  constructor(args: { deploymentId: DeploymentId }) {
    super({
      deploymentId: args.deploymentId,
      message: `deployment ${args.deploymentId} not found`,
    });
  }
}

/** The deployment already reached a terminal state — nothing to stop. */
class DeploymentNotCancellableError extends TaggedError("DeploymentNotCancellableError")<{
  message: string;
  deploymentId: DeploymentId;
  status: string;
}>() {
  constructor(args: { deploymentId: DeploymentId; status: string }) {
    super({
      deploymentId: args.deploymentId,
      status: args.status,
      message: `deployment is ${args.status}, not in flight`,
    });
  }
}

/** Stored statuses a cancel can act on. Derived states (`starting`, `crashed`)
 *  never reach the row, so the check is against stored values only. */
const CANCELLABLE: ReadonlySet<string> = new Set(["pending", "building"]);

/** Mirrors the helper container name in apps/builder/src/handler.ts. Changing
 *  one without the other silently turns cancel into a no-op that still marks
 *  the row — the build would keep running with nothing left watching it. */
function helperContainerName(deploymentId: DeploymentId): string {
  return `otterbuild-${deploymentId}`;
}

/**
 * Removes the queue entry for a deployment that has not started yet.
 *
 * Best-effort by nature: the job may be mid-transition to `active` as we look.
 * That is fine — the row is already `cancelled`, so the builder will read it and
 * stop on its own. Returns whether a job was actually removed, for logging.
 */
async function dequeue(deploymentId: DeploymentId): Promise<boolean> {
  const queue = getQueue(deployTriggeredJob.name);
  // `active` is deliberately excluded: removing a job BullMQ is currently
  // processing does not stop the worker, it just loses the bookkeeping.
  const jobs = await queue.getJobs(["waiting", "delayed", "paused"]);
  let removed = false;
  for (const job of jobs) {
    const ids = (job?.data as { deploymentIds?: unknown })?.deploymentIds;
    if (!Array.isArray(ids) || !ids.includes(deploymentId)) continue;
    // Shared job — its other deployments are still wanted. Leave it queued;
    // the builder skips this one when it reads the `cancelled` row.
    if (ids.length > 1) continue;
    try {
      await job.remove();
      removed = true;
    } catch {
      // Raced into `active` between getJobs and remove. The row write covers us.
    }
  }
  return removed;
}

/** Force-removes the helper container if one is running. Absent container (still
 *  queued, or already exited) is the normal case, not an error. */
async function killHelper(deploymentId: DeploymentId): Promise<boolean> {
  const result = await docker.containers
    .getContainer(helperContainerName(deploymentId))
    .remove({ force: true });
  return result.isOk();
}

export interface CancelResult {
  id: DeploymentId;
  status: "cancelled";
  /** True when a running build container was actually torn down. */
  killedHelper: boolean;
  /** True when a not-yet-started job was pulled from the queue. */
  dequeued: boolean;
}

export async function cancelDeployment(input: {
  deploymentId: DeploymentId;
  organizationId: OrganizationId;
  /** Shown in history so the row explains itself later. */
  cancelledBy: string;
}): Promise<Result<CancelResult, DeploymentNotFoundError | DeploymentNotCancellableError>> {
  // Join out to the org so a deploymentId from another tenant is a 404, never a
  // cancel. Scoping in the same query as the read keeps the check and the use
  // from drifting apart.
  const [row] = await db
    .select({ id: deployment.id, status: deployment.status, resourceId: deployment.resourceId })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(eq(deployment.id, input.deploymentId), eq(project.organizationId, input.organizationId)),
    )
    .limit(1);

  if (!row) return Result.err(new DeploymentNotFoundError({ deploymentId: input.deploymentId }));
  if (!CANCELLABLE.has(row.status)) {
    return Result.err(
      new DeploymentNotCancellableError({ deploymentId: input.deploymentId, status: row.status }),
    );
  }

  // Conditional on the status we just read: if the build converged to
  // running/failed in the gap, this updates zero rows and we report the race
  // honestly rather than stamping `cancelled` over a finished deploy.
  const updated = await db
    .update(deployment)
    .set({
      status: "cancelled",
      errorMessage: `Cancelled by ${input.cancelledBy}`,
      completedAt: new Date(),
    })
    .where(and(eq(deployment.id, input.deploymentId), eq(deployment.status, row.status)))
    .returning({ id: deployment.id });

  if (updated.length === 0) {
    return Result.err(
      new DeploymentNotCancellableError({
        deploymentId: input.deploymentId,
        status: "already settled",
      }),
    );
  }

  // Row first, teardown second — see the module comment. Both are best-effort:
  // whichever one applies, the row is already terminal.
  const [killedHelper, dequeued] = await Promise.all([
    killHelper(input.deploymentId),
    dequeue(input.deploymentId),
  ]);

  // Push to the project stream so the card flips immediately instead of on the
  // next poll — cancelling and then watching a spinner for 5s reads as a no-op.
  void publishResourceChanged(row.resourceId);

  return Result.ok({ id: input.deploymentId, status: "cancelled", killedHelper, dequeued });
}
