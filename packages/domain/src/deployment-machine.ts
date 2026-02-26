import { Result } from "better-result";
import { db, eq, and } from "@otterdeploy/db";
import { deployment, deploymentEvent } from "@otterdeploy/db/schema/deployment";
import { isDeploymentTerminalStatus } from "@otterdeploy/events";

import { createId } from "@otterdeploy/utils";

import { NotFoundError, ConflictError } from "./errors";

export { isDeploymentTerminalStatus };

type DeploymentStatus =
  | "queued"
  | "building"
  | "deploying"
  | "verifying"
  | "live"
  | "failed"
  | "canceled"
  | "rolled_back";

const VALID_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  queued: ["building", "canceled", "failed"],
  building: ["deploying", "failed", "canceled"],
  deploying: ["verifying", "failed"],
  verifying: ["live", "failed"],
  live: ["rolled_back"],
  failed: [],
  canceled: [],
  rolled_back: [],
};

export function assertValidTransition(
  current: DeploymentStatus,
  next: DeploymentStatus,
): Result<void, ConflictError> {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    return Result.err(
      new ConflictError({
        resource: "deployment",
        detail: `Invalid transition: ${current} → ${next}`,
      }),
    );
  }
  return Result.ok(undefined);
}

export async function transitionTo(
  deploymentId: string,
  nextStatus: DeploymentStatus,
  eventData: {
    actor: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<Result<void, NotFoundError | ConflictError>> {
  const row = await db.query.deployment.findFirst({
    where: eq(deployment.id, deploymentId),
  });

  if (!row) {
    return Result.err(new NotFoundError({ resource: "deployment", id: deploymentId }));
  }

  const currentStatus = row.status;

  // Idempotent: if already in target state, no-op
  if (currentStatus === nextStatus) {
    return Result.ok(undefined);
  }

  const transitionResult = assertValidTransition(currentStatus, nextStatus);
  if (transitionResult.isErr()) return transitionResult;

  const now = new Date();
  const updateSet: Record<string, unknown> = {
    status: nextStatus,
    updatedAt: now,
  };

  // Set startedAt when transitioning from queued to building
  if (currentStatus === "queued" && nextStatus === "building") {
    updateSet.startedAt = now;
  }

  // Set completedAt and duration for terminal states
  if (isDeploymentTerminalStatus(nextStatus)) {
    updateSet.completedAt = now;
    if (row.startedAt) {
      updateSet.duration = Math.round((now.getTime() - row.startedAt.getTime()) / 1000);
    }
  }

  // Optimistic lock: only update if status hasn't changed
  const updated = await db
    .update(deployment)
    .set(updateSet)
    .where(and(eq(deployment.id, deploymentId), eq(deployment.status, currentStatus)))
    .returning({ id: deployment.id });

  if (updated.length === 0) {
    return Result.err(
      new ConflictError({
        resource: "deployment",
        detail: "Status changed concurrently. Retry with latest state.",
      }),
    );
  }

  // Insert deployment event timeline entry
  await db.insert(deploymentEvent).values({
    id: createId(),
    deploymentId,
    status: nextStatus,
    previousStatus: currentStatus,
    actor: eventData.actor,
    reason: eventData.reason ?? null,
    metadata: eventData.metadata ?? {},
    createdAt: now,
  });

  return Result.ok(undefined);
}
