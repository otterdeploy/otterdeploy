/**
 * Bun Redis client used for log pub/sub. BullMQ keeps its own ioredis
 * connections internally; this module owns the dedicated publisher
 * the builder writes log lines through.
 */

import { RedisClient } from "bun";

import { env } from "@otterstack/env/server";

export function createPublisher(): RedisClient {
  return new RedisClient(env.REDIS_URL);
}
