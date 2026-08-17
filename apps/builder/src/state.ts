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

import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";

import { publishResourceChanged } from "@otterdeploy/api/routers/project/project-event-bus";
import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// Build error tails routinely carry ANSI color codes (pino pretty output, tool
// progress bars, the captured container stderr). Strip them at the storage
// boundary so the stored errorMessage is clean everywhere the UI reads it,
// the deployment timeline, history rows, toasts: instead of literal `[2m…`.
// Assembled from escape-sequence strings (the `ansi-regex` approach) so the
// pattern carries no control characters, literal or escaped, in a regex
// literal: CSI sequences, OSC strings (BEL- or ST-terminated), and the
// single-character Fe escapes.
const ESC = "\\x1b";
const BEL = "\\x07";
const ANSI = new RegExp(
  `${ESC}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?|[@-Z\\\\-_])`,
  "g",
);
const stripAnsi = (s: string): string => (s.includes("\x1b") ? s.replace(ANSI, "") : s);

/** Every status write pushes a resource-changed event to the project stream.
 *  Build-phase transitions happen in THIS process and produce no docker event,
 *  so without the publish the UI only notices on its 5s poll fallback.
 *  Fire-and-forget: publishResourceChanged swallows its own errors. */
function publishFor(rows: Array<{ resourceId: ResourceId }>): void {
  const resourceId = rows[0]?.resourceId;
  if (resourceId) {
    void publishResourceChanged(resourceId);
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
      // Strip ANSI first, then cap, so the 2000-char budget counts real
      // characters, not escape bytes.
      status: "failed",
      errorMessage: stripAnsi(errorMessage).slice(0, 2000),
      completedAt: new Date(),
    })
    // Only from a still-in-flight row. Cancelling force-removes the helper
    // container, so the build reliably dies mid-step and its error path calls
    // in here: unconditional, that would rewrite the operator's `cancelled`
    // into a red `failed` moments after they clicked stop. Terminal states are
    // terminal; the last writer must not win.
    .where(
      and(eq(deployment.id, deploymentId), inArray(deployment.status, ["pending", "building"])),
    )
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
