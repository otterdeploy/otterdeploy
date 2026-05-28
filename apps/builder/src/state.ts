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

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";

export async function markBuilding(deploymentId: DeploymentId): Promise<void> {
  await db
    .update(deployment)
    .set({ status: "building" })
    .where(eq(deployment.id, deploymentId));
}

export async function markFailed(
  deploymentId: DeploymentId,
  errorMessage: string,
): Promise<void> {
  await db
    .update(deployment)
    .set({
      status: "failed",
      errorMessage: errorMessage.slice(0, 2000),
      completedAt: new Date(),
    })
    .where(eq(deployment.id, deploymentId));
}

/**
 * Image is built and pushed but the swarm service hasn't been updated
 * yet. We update the row's `image` column so the next deploy step
 * knows which tag to launch.
 */
export async function markImageReady(
  deploymentId: DeploymentId,
  image: string,
): Promise<void> {
  await db
    .update(deployment)
    .set({ image })
    .where(eq(deployment.id, deploymentId));
}

/**
 * Swarm converged on the new image. Terminal happy-path state.
 */
export async function markRunning(deploymentId: DeploymentId): Promise<void> {
  await db
    .update(deployment)
    .set({ status: "running", completedAt: new Date() })
    .where(eq(deployment.id, deploymentId));
}
