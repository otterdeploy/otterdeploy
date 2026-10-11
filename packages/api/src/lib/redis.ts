/**
 * Redis client factory used by the API process outside the BullMQ
 * machinery (live log subscriptions, future pub/sub consumers).
 * BullMQ stays on ioredis (its own internal dependency). We don't
 * speak to it through this helper.
 *
 * Uses Bun's built-in RedisClient, which exposes pub/sub via a
 * callback signature (`subscribe(channel, (msg, ch) => …)`) rather
 * than the event-emitter pattern node-redis / ioredis use.
 */

import { env } from "@otterdeploy/env/server";
import { RedisClient } from "bun";

/**
 * Open a fresh Bun Redis client. Callers own the lifecycle. Call
 * `.close()` when done. A client that has called `subscribe()` can't
 * issue normal commands, so publish + subscribe in the same process
 * need two clients (call `createRedis()` twice or use `.duplicate()`).
 */
export function createRedis(options?: ConstructorParameters<typeof RedisClient>[1]): RedisClient {
  return new RedisClient(env.REDIS_URL, options);
}

/**
 * INCR a counter and make sure it carries an expiry, in ONE server-side step.
 *
 * The two-call form (`INCR`, then `EXPIRE` when the count is 1) leaves a key
 * with no TTL whenever anything fails between the calls (a Redis blip, the
 * process dying): a rate window that never resets, a permanent lockout for
 * that email or IP. The script runs atomically, and it sets the
 * expiry whenever the key has none rather than only on the first hit, so a
 * counter already stranded by the old form heals on its next use instead of
 * staying locked forever.
 */
const INCR_WITH_EXPIRY = `local n = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

export async function incrWithExpiry(
  client: RedisClient,
  key: string,
  ttlSeconds: number,
): Promise<number> {
  const count: unknown = await client.send("EVAL", [
    INCR_WITH_EXPIRY,
    "1",
    key,
    String(ttlSeconds),
  ]);
  // A reply that is not a count fails closed: NaN is under no limit.
  return typeof count === "number" ? count : Number.NaN;
}
