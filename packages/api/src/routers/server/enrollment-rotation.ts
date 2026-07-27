import { db } from "@otterdeploy/db";
import { nodeEnrollment, swarmJoinRotation } from "@otterdeploy/db/schema";
import { Docker } from "@otterdeploy/docker";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { log } from "evlog";

import type { EnrollmentRole, SwarmInspect } from "./enrollment-credential";

import { buildSwarmRotationOptions } from "./enrollment-credential";

function rotationError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 500);
}

async function performSwarmJoinCredentialRotation(
  role: EnrollmentRole,
  requiredAt: Date,
): Promise<void> {
  // Revoke before Docker rotation: otherwise an old enrollment could race the
  // update and resolve to the replacement token. Failures remain revoked.
  await db
    .update(nodeEnrollment)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(nodeEnrollment.role, role),
        isNull(nodeEnrollment.revokedAt),
        isNull(nodeEnrollment.completedAt),
      ),
    );

  const docker = Docker.fromEnv();
  try {
    const inspected = await docker.system.swarmInspect();
    if (inspected.isErr()) throw inspected.error;
    const swarm = inspected.value as SwarmInspect;
    const rotated = await docker.system.swarmUpdate(buildSwarmRotationOptions(swarm, role));
    if (rotated.isErr()) throw rotated.error;
  } catch (cause) {
    await db
      .update(swarmJoinRotation)
      .set({
        attempts: sql`${swarmJoinRotation.attempts} + 1`,
        lastError: rotationError(cause),
      })
      .where(
        and(
          eq(swarmJoinRotation.role, role),
          eq(swarmJoinRotation.requiredAt, requiredAt),
          isNull(swarmJoinRotation.completedAt),
        ),
      );
    throw cause;
  } finally {
    docker.destroy();
  }

  const completedAt = new Date();
  const [completed] = await db
    .update(swarmJoinRotation)
    .set({
      completedAt,
      attempts: sql`${swarmJoinRotation.attempts} + 1`,
      lastError: null,
    })
    .where(
      and(
        eq(swarmJoinRotation.role, role),
        eq(swarmJoinRotation.requiredAt, requiredAt),
        isNull(swarmJoinRotation.completedAt),
      ),
    )
    .returning({ role: swarmJoinRotation.role });

  // A newer request superseded this one. It owns acknowledgement and will
  // perform another rotation, so do not resolve its enrollment evidence.
  if (!completed) return;
  await db
    .update(nodeEnrollment)
    .set({ completedAt })
    .where(
      and(
        eq(nodeEnrollment.role, role),
        isNotNull(nodeEnrollment.revokedAt),
        isNull(nodeEnrollment.completedAt),
      ),
    );
}

/**
 * Persist the rotation requirement before touching Docker. The background
 * reaper retries this outbox row across daemon outages and process restarts.
 */
export async function rotateSwarmJoinCredential(role: EnrollmentRole): Promise<void> {
  const requiredAt = new Date();
  await db
    .insert(swarmJoinRotation)
    .values({ role, requiredAt })
    .onConflictDoUpdate({
      target: swarmJoinRotation.role,
      set: {
        requiredAt,
        completedAt: null,
        attempts: 0,
        lastError: null,
      },
    });
  await performSwarmJoinCredentialRotation(role, requiredAt);
}

let reaperRunning = false;

/** Retry durable rotation requests and rotate credentials exposed by a
 * redeemed enrollment that expired before its completion callback arrived. */
async function reapNodeEnrollments(now = new Date()): Promise<void> {
  if (reaperRunning) return;
  reaperRunning = true;
  try {
    const unresolvedRoles = new Set<EnrollmentRole>();
    const pending = await db
      .select({
        role: swarmJoinRotation.role,
        requiredAt: swarmJoinRotation.requiredAt,
      })
      .from(swarmJoinRotation)
      .where(isNull(swarmJoinRotation.completedAt));
    for (const request of pending) {
      await performSwarmJoinCredentialRotation(request.role, request.requiredAt).catch((cause) => {
        unresolvedRoles.add(request.role);
        log.warn({
          nodeEnrollment: {
            event: "rotation-retry-failed",
            role: request.role,
            error: rotationError(cause),
          },
        });
      });
    }

    const stale = await db
      .select({ role: nodeEnrollment.role })
      .from(nodeEnrollment)
      .where(
        and(
          lte(nodeEnrollment.expiresAt, now),
          isNotNull(nodeEnrollment.redeemedAt),
          isNull(nodeEnrollment.completedAt),
        ),
      );
    for (const role of new Set(stale.map((row) => row.role))) {
      if (unresolvedRoles.has(role)) continue;
      await rotateSwarmJoinCredential(role).catch((cause) => {
        log.warn({
          nodeEnrollment: {
            event: "expired-rotation-failed",
            role,
            error: rotationError(cause),
          },
        });
      });
    }
  } finally {
    reaperRunning = false;
  }
}

export function startNodeEnrollmentReaper(intervalMs = 60_000): () => void {
  const tick = () => void reapNodeEnrollments();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  const kickoff = setTimeout(tick, 15_000);
  kickoff.unref();
  return () => {
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
