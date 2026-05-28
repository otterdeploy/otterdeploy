import type { CacheConfig } from "drizzle-orm/cache/core/types";

import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { Table, getTableName } from "drizzle-orm";
import { Cache, type MutationOption } from "drizzle-orm/cache/core";
import { entityKind, is } from "drizzle-orm/entity";
import { log as globalLog } from "evlog";

const KEY_PREFIX = "drizzle:cache:";
const TABLE_SET_PREFIX = "drizzle:cache:tables:";
const TAG_PREFIX = "drizzle:cache:tag:";

interface RedisCacheOptions {
  /** Default TTL (seconds) for cached entries. */
  ttl?: number;
  /** When true, drizzle caches every query unless explicitly skipped. */
  global?: boolean;
}

/**
 * Drizzle query cache backed by Redis (via Bun's built-in RedisClient).
 *
 * - Result-wraps every Redis call so transient errors degrade to cache-miss
 *   instead of taking down the request.
 * - Tracks a Redis SET per Drizzle table so invalidation on writes is
 *   a single SUNION + DEL.
 */
export class RedisCache extends Cache {
  static readonly [entityKind] = "RedisCache";

  private readonly defaultTtl: number;
  private readonly useGlobally: boolean;
  private readonly client: Bun.RedisClient;

  constructor({ ttl = 60, global = false }: RedisCacheOptions = {}) {
    super();
    this.defaultTtl = ttl;
    this.useGlobally = global;
    this.client = new Bun.RedisClient(env.REDIS_URL, {
      // Reject commands immediately while disconnected; Result wrapping
      // below turns the rejection into a graceful cache-miss / no-op.
      enableOfflineQueue: false,
    });
  }

  strategy(): "all" | "explicit" {
    return this.useGlobally ? "all" : "explicit";
  }

  async get(
    key: string,
    _tables: string[],
    isTag = false,
    _isAutoInvalidate?: boolean,
  ): Promise<unknown[] | undefined> {
    const fullKey = (isTag ? TAG_PREFIX : KEY_PREFIX) + key;

    const result = await Result.tryPromise(() => this.client.get(fullKey));
    if (result.isErr()) {
      globalLog.warn({
        message: "[cache] Redis GET failed; treating as cache miss",
        key: fullKey,
        error: result.error,
      });
      return undefined;
    }

    const raw = result.value;
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as unknown[];
    } catch (error) {
      globalLog.warn({
        message: "[cache] Cached value failed to parse; treating as cache miss",
        key: fullKey,
        error,
      });
      return undefined;
    }
  }

  async put(
    key: string,
    response: unknown,
    tables: string[],
    isTag = false,
    config?: CacheConfig,
  ): Promise<void> {
    const ttl = config?.ex ?? this.defaultTtl;
    const fullKey = (isTag ? TAG_PREFIX : KEY_PREFIX) + key;
    const value = JSON.stringify(response);

    const setResult = await Result.tryPromise(() =>
      this.client.set(fullKey, value, "EX", ttl),
    );
    if (setResult.isErr()) {
      globalLog.warn({
        message: "[cache] Redis SET failed; skipping put",
        key: fullKey,
        error: setResult.error,
      });
      return;
    }

    for (const table of tables) {
      const setKey = TABLE_SET_PREFIX + table;
      const indexResult = await Result.tryPromise(async () => {
        await this.client.sadd(setKey, fullKey);
        await this.client.expire(setKey, ttl * 2);
      });
      if (indexResult.isErr()) {
        globalLog.warn({
          message: "[cache] Redis table-index update failed",
          table,
          key: fullKey,
          error: indexResult.error,
        });
      }
    }
  }

  async onMutate(params: MutationOption): Promise<void> {
    const tags = Array.isArray(params.tags)
      ? params.tags
      : params.tags
        ? [params.tags]
        : [];
    const tableInputs = Array.isArray(params.tables)
      ? params.tables
      : params.tables
        ? [params.tables]
        : [];

    const tableNames = tableInputs.map((t) =>
      is(t, Table) ? getTableName(t) : String(t),
    );

    const setKeys = tableNames.map((t) => TABLE_SET_PREFIX + t);
    const keysToDelete: string[] = [];

    if (setKeys.length > 0) {
      const [first, ...rest] = setKeys;
      const sunionResult = await Result.tryPromise(() =>
        this.client.sunion(first ?? "", ...rest),
      );
      if (sunionResult.isErr()) {
        globalLog.warn({
          message: "[cache] Redis SUNION failed; skipping invalidation",
          tables: tableNames,
          error: sunionResult.error,
        });
        return;
      }
      keysToDelete.push(...sunionResult.value, ...setKeys);
    }

    if (tags.length > 0) {
      keysToDelete.push(...tags.map((tag) => TAG_PREFIX + tag));
    }

    if (keysToDelete.length > 0) {
      const delResult = await Result.tryPromise(() => this.client.del(...keysToDelete));
      if (delResult.isErr()) {
        globalLog.warn({
          message: "[cache] Redis DEL failed during invalidation",
          keyCount: keysToDelete.length,
          error: delResult.error,
        });
      }
    }
  }
}

export function redisCache(options: RedisCacheOptions = {}): RedisCache {
  return new RedisCache(options);
}
