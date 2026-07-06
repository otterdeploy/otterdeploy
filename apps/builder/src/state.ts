/**
 * Deployment state transitions used by the build pipeline.
 *
 * The full state machine (from packages/db/src/schema/project.ts):
 *
 *   pending → building → running | failed
 *                     ↘ failed
 *           ↘ failed
 *
 * Phase 3b owns the pending → building edge and the failed terminal.
 * The success terminal (→ running) is reached only after the swarm
 * service has converged on the new image, which lands in Phase 3c.
 * Until then a successful build leaves the row in `building` and emits
 * a `system` log line marking the image-ready point.
 */

import type { DeploymentId } from "@otterdeploy/shared/id";

import { publishResourceChanged } from "@otterdeploy/api/routers/project/project-event-bus";
import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";

/** Every status write pushes a resource-changed event to the project stream —
 *  build-phase transitions happen in THIS process and produce no docker event,
 *  so without the publish the UI only notices on its 5s poll fallback.
 *  Fire-and-forget: publishResourceChanged swallows its own errors. */
function publishFor(rows: Array<{ resourceId: string }>): void {
  const resourceId = rows[0]?.resourceId;
  if (resourceId) {
    void publishResourceChanged(resourceId as Parameters<typeof publishResourceChanged>[0]);
  }
}

export async function markBuilding(deploymentId: DeploymentId): Promise<void> {
  const rows = await db
    .update(deployment)
    .set({ status: "building", errorMessage: null, completedAt: null })
    .where(eq(deployment.id, deploymentId))
    .returning({ resourceId: deployment.resourceId });
  publishFor(rows);
}

export async function markFailed(deploymentId: DeploymentId, errorMessage: string): Promise<void> {
  const rows = await db
    .update(deployment)
    .set({
      status: "failed",
      errorMessage: errorMessage.slice(0, 2000),
      completedAt: new Date(),
    })
    .where(eq(deployment.id, deploymentId))
    .returning({ resourceId: deployment.resourceId });
  publishFor(rows);
}

/**
 * Image is built and pushed but the swarm service hasn't been updated
 * yet. We update the row's `image` column so the next deploy step
 * knows which tag to launch.
 */
export async function markImageReady(deploymentId: DeploymentId, image: string): Promise<void> {
  await db
    .update(deployment)
    .set({ image, errorMessage: null })
    .where(eq(deployment.id, deploymentId));
}

/**
 * Swarm converged on the new image. Terminal happy-path state.
 */
export async function markRunning(deploymentId: DeploymentId): Promise<void> {
  const rows = await db
    .update(deployment)
    .set({ status: "running", errorMessage: null, completedAt: new Date() })
    .where(eq(deployment.id, deploymentId))
    .returning({ resourceId: deployment.resourceId });
  publishFor(rows);
}

/**
 * Read a deployment's current status. The batch handler uses this to verify a
 * helper that exited 0 actually converged the row: a build that no-ops (e.g. a
 * redundant deploy of an already-built SHA) can exit 0 without ever running the
 * pipeline, and must not be left as a phantom `pending`/`building` row with no
 * logs. Returns null if the row is gone.
 */
export async function getDeploymentStatus(
  deploymentId: DeploymentId,
): Promise<(typeof deployment.$inferSelect)["status"] | null> {
  const [row] = await db
    .select({ status: deployment.status })
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .limit(1);
  return row?.status ?? null;
}
