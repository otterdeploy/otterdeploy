/**
 * ioredis client used for log pub/sub. BullMQ already speaks to Redis,
 * but its internal connections are scoped to queue/worker semantics —
 * cleaner to keep the log publisher as a dedicated client we control
 * the lifecycle of.
 */

import { env } from "@otterstack/env/server";
import { Redis } from "ioredis";

export function createPublisher(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
}
