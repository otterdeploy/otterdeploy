/**
 * ioredis client used outside the BullMQ machinery (live log subscriptions,
 * future pub/sub consumers). BullMQ instantiates its own connections; this
 * module owns the ones that the API process opens directly.
 */

import { env } from "@otterstack/env/server";
import { Redis } from "ioredis";

/**
 * Open a fresh Redis client. Callers own the lifecycle — call `.quit()`
 * when done. A subscriber client (post-`SUBSCRIBE`) can't issue normal
 * commands, so callers expecting to publish + subscribe need two
 * clients (use `subscribeClient = client.duplicate()` or just call
 * `createRedis()` twice).
 *
 * `maxRetriesPerRequest: null` mirrors the BullMQ setting — without
 * it, blocking commands tear down on transient errors.
 */
export function createRedis(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
}
