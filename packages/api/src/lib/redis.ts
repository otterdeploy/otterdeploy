/**
 * Redis client factory used by the API process outside the BullMQ
 * machinery (live log subscriptions, future pub/sub consumers).
 * BullMQ stays on ioredis (its own internal dependency) — we don't
 * speak to it through this helper.
 *
 * Uses Bun's built-in RedisClient, which exposes pub/sub via a
 * callback signature (`subscribe(channel, (msg, ch) => …)`) rather
 * than the event-emitter pattern node-redis / ioredis use.
 */

import { RedisClient } from "bun";

import { env } from "@otterdeploy/env/server";

/**
 * Open a fresh Bun Redis client. Callers own the lifecycle — call
 * `.close()` when done. A client that has called `subscribe()` can't
 * issue normal commands, so publish + subscribe in the same process
 * need two clients (call `createRedis()` twice or use `.duplicate()`).
 */
export function createRedis(): RedisClient {
  return new RedisClient(env.REDIS_URL);
}
