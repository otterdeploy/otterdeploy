/**
 * Runtime lifecycle state for a service row: the force-update counter, the
 * pause/resume replica flip, and the public-exposure mirrors.
 *
 * Split out of `service.ts`: none of these are part of the patchable spec
 * surface that `updateServiceRecord` owns — they are written by the runtime
 * and edge paths instead.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serviceResource } from "@otterdeploy/db/schema/project";
import { eq, sql } from "drizzle-orm";

import type { ServiceResourceRow } from ".";

export async function bumpForceUpdateCounter(resourceId: ResourceId): Promise<number | undefined> {
  const [updated] = await db
    .update(serviceResource)
    .set({ forceUpdateCounter: sql`${serviceResource.forceUpdateCounter} + 1` })
    .where(eq(serviceResource.resourceId, resourceId))
    .returning({ forceUpdateCounter: serviceResource.forceUpdateCounter });
  return updated?.forceUpdateCounter;
}

/**
 * Atomically flip the pause state: pause writes (replicas: 0, pausedReplicas:
 * previous count); resume writes (replicas: restored count, pausedReplicas:
 * null). Kept separate from `updateServiceRecord` — pausedReplicas is runtime
 * lifecycle state, not part of the patchable spec surface.
 */
export async function setServiceReplicaState(
  resourceId: ResourceId,
  input: { replicas: number; pausedReplicas: number | null },
): Promise<ServiceResourceRow | undefined> {
  const [updated] = await db
    .update(serviceResource)
    .set({ replicas: input.replicas, pausedReplicas: input.pausedReplicas })
    .where(eq(serviceResource.resourceId, resourceId))
    .returning();
  return updated;
}

export async function setPublicExposure(input: {
  resourceId: ResourceId;
  enabled: boolean;
  publicDomain: string | null;
}) {
  const [updated] = await db
    .update(serviceResource)
    .set({ publicEnabled: input.enabled, publicDomain: input.publicDomain })
    .where(eq(serviceResource.resourceId, input.resourceId))
    .returning();
  return updated;
}

/** Update only the denormalized primary-domain mirror, leaving the
 *  publicEnabled toggle untouched. Used when the operator picks a new
 *  primary among several hosts — the set of routes (and thus reachability)
 *  doesn't change, just which host the panel/graph/views surface. */
export async function setServicePublicDomain(resourceId: ResourceId, publicDomain: string | null) {
  const [updated] = await db
    .update(serviceResource)
    .set({ publicDomain })
    .where(eq(serviceResource.resourceId, resourceId))
    .returning();
  return updated;
}
