import { db, eq, and } from "@otterstack/db";
import { deployment, deploymentEvent } from "@otterstack/db/schema/deployment";
import { isDeploymentTerminalStatus } from "@otterstack/events";

import { DomainError } from "./errors";

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

export function assertValidTransition(current: DeploymentStatus, next: DeploymentStatus): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new DomainError(
      "CONFLICT",
      `Invalid deployment transition: ${current} → ${next}`,
    );
  }
}

export async function transitionTo(
  deploymentId: string,
  nextStatus: DeploymentStatus,
  eventData: {
    actor: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const row = await db.query.deployment.findFirst({
    where: eq(deployment.id, deploymentId),
  });

  if (!row) {
    throw new DomainError("NOT_FOUND", "Deployment not found");
  }

  const currentStatus = row.status as DeploymentStatus;

  // Idempotent: if already in target state, no-op
  if (currentStatus === nextStatus) {
    return;
  }

  assertValidTransition(currentStatus, nextStatus);

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
  await db
    .update(deployment)
    .set(updateSet)
    .where(and(eq(deployment.id, deploymentId), eq(deployment.status, currentStatus)));

  // Insert deployment event timeline entry
  await db.insert(deploymentEvent).values({
    id: crypto.randomUUID(),
    deploymentId,
    status: nextStatus,
    previousStatus: currentStatus,
    actor: eventData.actor,
    reason: eventData.reason ?? null,
    metadata: eventData.metadata ?? {},
    createdAt: now,
  });
}
