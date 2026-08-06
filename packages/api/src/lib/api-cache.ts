import type { ApiCacheIdentity } from "@otterdeploy/shared/api-cache";
import type { RedisClient } from "bun";
import type * as z from "zod";

import { apiCacheTableSetKey, reviveRichValues, tagRichValues } from "@otterdeploy/db/cache";
import { Result } from "better-result";
import { log as globalLog } from "evlog";

import { createRedis } from "./redis";

let client: RedisClient | null = null;

function redis(): RedisClient {
  client ??= createRedis({ enableOfflineQueue: false });
  return client;
}

/** A Redis failure is a cache miss; endpoint availability never depends on it. */
export async function readApiCache<T>(
  identity: ApiCacheIdentity,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const result = await Result.tryPromise(() => redis().get(identity.dataKey));
  if (result.isErr()) {
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
  await Result.tryPromise(() => redis().del(identity.dataKey));
  return undefined;
}

export async function writeApiCache(
  identity: ApiCacheIdentity,
  value: unknown,
  options: { ttlSeconds: number; dependencyTables: readonly string[] },
): Promise<void> {
  const encoded = JSON.stringify(value, tagRichValues);
  const write = await Result.tryPromise(async () => {
    const r = redis();
    await r.set(identity.dataKey, encoded, "EX", String(options.ttlSeconds));
    for (const tableName of new Set(options.dependencyTables)) {
      const indexKey = apiCacheTableSetKey(tableName);
      await r.sadd(indexKey, identity.dataKey);
      await r.expire(indexKey, options.ttlSeconds * 2);
    }
  });

  if (write.isErr()) {
    // A value without all dependency indexes could survive a table write.
    // Remove it immediately and fall back to the uncached endpoint path.
    await Result.tryPromise(() => redis().del(identity.dataKey));
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
  const invalidation = await Result.tryPromise(async () => {
    const r = redis();
    await r.del(identity.dataKey);
    await r.publish(
      identity.eventChannel,
      JSON.stringify({ type: "invalidate", cacheHash: identity.hash }),
    );
  });

  if (invalidation.isErr()) {
    globalLog.warn({
      message: "[api-cache] Redis invalidation failed",
      key: identity.dataKey,
      error: invalidation.error,
    });
  }
}
