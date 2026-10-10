/**
 * One roll of a given service at a time, in this process.
 *
 * A service's rollout now runs off the request (./rollout.ts), so the request
 * paths that roll a service inline (a domain add, an env write) can land while
 * its background rollout is still gating. Two rolls of one service at once race
 * on the same runtime objects: the plain-Docker driver's candidate and parked
 * containers (`<name>--next`, `<name>--prev`), swarm's update version. So every
 * roll of a service waits for the one before it; each reads the service's
 * record when its turn comes, so the last one rolls the latest saved config.
 *
 * In-process is enough: the API and the `service.rollout` worker run in the one
 * control-plane process (apps/server).
 */
import { Result } from "better-result";

const tails = new Map<string, Promise<unknown>>();

/** Run `roll` once every earlier roll under `key` has finished. */
export async function serializeRoll<T>(key: string, roll: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(roll);
  // The queue's tail never rejects: a failed roll must not block the next.
  const tail = Result.tryPromise(() => run);
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}

/** The lock key for a service's base roll, or one PR preview's. */
export function rollKey(resourceId: string, previewId?: string | null): string {
  return previewId ? `${resourceId}:${previewId}` : resourceId;
}
