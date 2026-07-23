/**
 * Deployment settlement — the write-side companion to `deployments-list.ts`
 * (split out to keep that file under the size cap). The list read derives
 * status live; when the derivation notices a building/pending row whose tasks
 * came up (or died), these persist the flip and emit the deploy.succeeded /
 * deploy.failed event exactly once.
 */
import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deploymentLog } from "@otterdeploy/db/schema/build";
import { deployment } from "@otterdeploy/db/schema/project";
import { inFlightDeploys } from "@otterdeploy/jobs";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { DeploymentRow } from "./deployments";
import type { InstanceGlimpse } from "./deployments-derive";

import { BUILD_LOG_QUIET_MS, ZERO_TASK_STALE_MS } from "./deployments-derive";
import { emitDeploySucceeded } from "./deployments-emit";
import { publishResourceChanged } from "./project-event-bus";

/**
 * Persist the building/pending → running flip for deployments whose tasks have
 * come up, and emit `deploy.succeeded` exactly once per deployment. The
 * conditional UPDATE (status still building/pending) is the concurrency guard:
 * only the caller whose update actually changes a row emits, so concurrent
 * list requests can't double-fire. This is the "success detector" — the list
 * read reconciles lazily, and provisioning paths that already waited for the
 * container to come up call it eagerly so the Deployments card flips in the
 * same moment as the live runtime badge instead of a poll later.
 */
export async function reconcileDeploySuccess(
  deploymentIds: DeploymentId[],
  resourceId: ResourceId,
): Promise<void> {
  for (const id of deploymentIds) {
    const flipped = await db
      .update(deployment)
      .set({ status: "running", completedAt: new Date() })
      .where(and(eq(deployment.id, id), inArray(deployment.status, ["building", "pending"])))
      .returning({ id: deployment.id });
    if (flipped.length > 0) {
      void publishResourceChanged(resourceId);
      await emitDeploySucceeded({ deploymentId: id, resourceId });
    }
  }
}

const STALE_BUILD_MESSAGE =
  "No container appeared and the build produced no output for over 3 minutes — " +
  "the build process likely died or was never picked up (is the builder running?).";

/**
 * Persist the stale zero-task building/pending → failed flip the derivation
 * decided on, and emit `deploy.failed` exactly once. Mirror of
 * `reconcileDeploySuccess`: the conditional UPDATE (status still
 * building/pending) is the concurrency guard, so concurrent list reads can't
 * double-fire, and a builder that grabs the row at the same moment wins.
 */
export async function reconcileDeployFailure(deploymentIds: DeploymentId[]): Promise<void> {
  const { markDeploymentFailed } = await import("./deployments");
  for (const id of deploymentIds) {
    const flipped = await db
      .update(deployment)
      .set({ status: "failed", errorMessage: STALE_BUILD_MESSAGE, completedAt: new Date() })
      .where(and(eq(deployment.id, id), inArray(deployment.status, ["building", "pending"])))
      .returning({ id: deployment.id });
    // markDeploymentFailed re-writes the same terminal values (harmless) and
    // owns the publish + deploy.failed notification plumbing.
    if (flipped.length > 0) await markDeploymentFailed(id, STALE_BUILD_MESSAGE);
  }
}

/**
 * Is the latest deployment's build still producing output? Only consulted
 * when the zero-task stale window would flip it to "failed" — one indexed
 * lookup for the newest log line, skipped entirely on the happy paths.
 */
export async function isBuildStillLogging(
  // Only `id`/`status`/`createdAt` are read — a Pick lets the project-wide
  // feed's snapshot-free JoinedRow reuse this without carrying the full row.
  latest: Pick<DeploymentRow, "id" | "status" | "createdAt"> | undefined,
  tasksByDeployment: Map<string, InstanceGlimpse[]>,
): Promise<boolean> {
  if (!latest) return false;
  if (latest.status !== "building" && latest.status !== "pending") return false;
  if ((tasksByDeployment.get(latest.id) ?? []).length > 0) return false;
  if (Date.now() - latest.createdAt.getTime() <= ZERO_TASK_STALE_MS) return false;
  // Queue-aware guard: a deployment owned by an in-flight `deploy.triggered`
  // job WHILE the worker is actively building something is legitimately in the
  // pipeline — queued behind another build (concurrency=1) or building itself —
  // so its log-silence must NOT fail it. If it's owned but nothing is active,
  // the builder isn't consuming the queue (likely down); fall through to the
  // log-recency check, which fails it after the stale window ("is the builder
  // running?"). A row with no owning job at all also falls through.
  const { ownedIds, anyActive } = await inFlightDeploys();
  if (ownedIds.has(latest.id) && anyActive) return true;
  const [lastLine] = await db
    .select({ ts: deploymentLog.ts })
    .from(deploymentLog)
    .where(eq(deploymentLog.deploymentId, latest.id))
    .orderBy(desc(deploymentLog.seq))
    .limit(1);
  return lastLine != null && Date.now() - lastLine.ts.getTime() < BUILD_LOG_QUIET_MS;
}
