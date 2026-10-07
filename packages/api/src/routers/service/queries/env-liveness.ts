/**
 * The write side of "is the saved env live?": every write to a service's own
 * env rows stamps `serviceResource.envChangedAt`, but only when something
 * really changed. Split from ./env.ts for file size.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serviceResource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";

/** Anything that can run an update: the pool or an open transaction. */
type EnvWriter = Pick<typeof db, "update">;

/**
 * Stamp "this service's env changed" on the service row. Every write to its
 * base env rows calls this, in the same transaction, so the Variables tab can
 * tell a saved value from a live one (see serviceResource.envChangedAt).
 */
export async function markEnvChanged(
  writer: EnvWriter,
  serviceResourceId: ResourceId,
): Promise<void> {
  await writer
    .update(serviceResource)
    // The app clock, like `envAppliedAt` (redeploy.ts): the two are compared.
    .set({ envChangedAt: new Date() })
    .where(eq(serviceResource.resourceId, serviceResourceId));
}

/** Did a wholesale replace change any key, value or secret flag? Exported
 *  for the tests. */
export function envBagChanged(
  before: ReadonlyArray<{ key: string; value: string; isSecret?: boolean }>,
  after: ReadonlyArray<{ key: string; value: string; isSecret?: boolean }>,
): boolean {
  if (before.length !== after.length) return true;
  const was = new Map(before.map((r) => [r.key, r]));
  return after.some((r) => {
    const prior = was.get(r.key);
    return !prior || prior.value !== r.value || (prior.isSecret ?? false) !== (r.isSecret ?? false);
  });
}
