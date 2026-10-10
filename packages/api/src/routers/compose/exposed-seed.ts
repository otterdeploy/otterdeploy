/**
 * The one writer of a stack's `exposed` list after create: whether a compose
 * service's exposure seed still has to land.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { composeResource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";

/**
 * Record whether one compose service's exposure seed still has to land
 * (`ComposeExposed.seedPending`). The stack's `exposed` list is otherwise
 * never written after create, so this is the only writer; a row that no
 * longer names the service is left alone.
 */
export async function setExposedSeedPending(
  stackResourceId: ResourceId,
  service: string,
  pending: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ exposed: composeResource.exposed })
      .from(composeResource)
      .where(eq(composeResource.resourceId, stackResourceId))
      .for("update");
    if (!row) return;
    let changed = false;
    const exposed = row.exposed.map((entry) => {
      if (entry.service !== service || (entry.seedPending === true) === pending) return entry;
      changed = true;
      const { seedPending: _dropped, ...rest } = entry;
      return pending ? { ...rest, seedPending: true } : rest;
    });
    if (!changed) return;
    await tx
      .update(composeResource)
      .set({ exposed })
      .where(eq(composeResource.resourceId, stackResourceId));
  });
}
