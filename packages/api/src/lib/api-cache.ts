import type { ApiCacheIdentity } from "@otterdeploy/shared/api-cache";
import type { RedisClient } from "bun";
import type * as z from "zod";

import { apiCacheTableSetKey, reviveRichValues, tagRichValues } from "@otterdeploy/db/cache";
import { cacheRedisCircuit, RedisCircuitOpenError } from "@otterdeploy/db/redis-circuit";
import { log as globalLog } from "evlog";

import { createRedis } from "./redis";

let client: RedisClient | null = null;

function redis(): RedisClient {
  client ??= createRedis({ enableOfflineQueue: false });
  return client;
}

/**
 * A Redis failure is a cache miss; endpoint availability never depends on it.
 *
 * Every call goes through the query cache's circuit (packages/db
 * redis-circuit.ts): a 2 s deadline per call, and once Redis has failed the
 * next calls are skipped outright for a few seconds. Without the deadline a
 * blackholed Redis held the read here until the command settled, which for
 * a dropped connection is never.
 */
export async function readApiCache<T>(
  identity: ApiCacheIdentity,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const result = await cacheRedisCircuit.run("api-cache GET", () => redis().get(identity.dataKey));
  if (result.isErr()) {
    if (RedisCircuitOpenError.is(result.error)) return undefined;
    globalLog.warn({
      message: "[api-cache] Redis GET failed; treating as cache miss",
      key: identity.dataKey,
      error: result.error,
    });
    return undefined;
  }
  if (result.value == null) return undefined;

  try {
    const parsed = schema.safeParse(JSON.parse(result.value, reviveRichValues));
    if (parsed.success) return parsed.data;
    globalLog.warn({
      message: "[api-cache] Cached response failed schema validation; treating as cache miss",
      key: identity.dataKey,
      issues: parsed.error.issues,
    });
  } catch (error) {
    globalLog.warn({
      message: "[api-cache] Cached response failed to parse; treating as cache miss",
      key: identity.dataKey,
      error,
    });
  }

  // Best-effort cleanup prevents every request from reparsing a corrupt value.
  await cacheRedisCircuit.run("api-cache DEL", () => redis().del(identity.dataKey));
  return undefined;
}

export async function writeApiCache(
  identity: ApiCacheIdentity,
  value: unknown,
  options: { ttlSeconds: number; dependencyTables: readonly string[] },
): Promise<void> {
  const encoded = JSON.stringify(value, tagRichValues);
  const write = await cacheRedisCircuit.run("api-cache SET", async () => {
    const r = redis();
    await r.set(identity.dataKey, encoded, "EX", String(options.ttlSeconds));
    for (const tableName of new Set(options.dependencyTables)) {
      const indexKey = apiCacheTableSetKey(tableName);
      await r.sadd(indexKey, identity.dataKey);
      await r.expire(indexKey, options.ttlSeconds * 2);
    }
  });

  if (write.isErr()) {
    // Skipped outright: nothing was written, nothing to undo.
    if (RedisCircuitOpenError.is(write.error)) return;
    // A value without all dependency indexes could survive a table write.
    // Remove it immediately (forced: the circuit just opened on this very
    // failure) and fall back to the uncached endpoint path.
    await cacheRedisCircuit.run("api-cache DEL", () => redis().del(identity.dataKey), {
      force: true,
    });
    globalLog.warn({
      message: "[api-cache] Redis SET/index update failed; skipping cache put",
      key: identity.dataKey,
      error: write.error,
    });
  }
}

/**
 * Exact manual invalidation for non-Drizzle changes. It also publishes the
 * same identity to the authenticated subscription transport's Redis channel.
 */
export async function invalidateApiCache(identity: ApiCacheIdentity): Promise<void> {
  // Forced: invalidation is attempted even while the circuit is open.
  const invalidation = await cacheRedisCircuit.run(
    "api-cache invalidate",
    async () => {
      const r = redis();
      await r.del(identity.dataKey);
      await r.publish(
        identity.eventChannel,
        JSON.stringify({ type: "invalidate", cacheHash: identity.hash }),
      );
    },
    { force: true },
  );

  if (invalidation.isErr()) {
    globalLog.warn({
      message: "[api-cache] Redis invalidation failed",
      key: identity.dataKey,
      error: invalidation.error,
    });
  }
}
