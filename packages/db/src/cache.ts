import type { CacheConfig } from "drizzle-orm/cache/core/types";

import { env } from "@otterdeploy/env/server";
import { type UnknownRecord, isJsonObject } from "@otterdeploy/shared/json";
import { getTableName, type Table } from "drizzle-orm";
import { Cache, type MutationOption } from "drizzle-orm/cache/core";
import { entityKind } from "drizzle-orm/entity";
import { log as globalLog } from "evlog";

import { cacheRedisCircuit, RedisCircuitOpenError } from "./redis-circuit";

const KEY_PREFIX = "drizzle:cache:";
const TABLE_SET_PREFIX = "drizzle:cache:tables:";
const TAG_PREFIX = "drizzle:cache:tag:";
const API_TABLE_SET_PREFIX = "api:cache:tables:";

/** Redis set used by endpoint caches which depend on a Drizzle table. */
export function apiCacheTableSetKey(tableName: string): string {
  return API_TABLE_SET_PREFIX + tableName;
}

// JSON can't represent every value the driver hands back, so we tag the
// problem types on the way out and rebuild them on the way in, keeping the
// cached shape byte-for-byte identical to a fresh query. Without this a cache
// hit would differ from a cache miss (or, for BigInt, the put would throw and
// take the whole query down). The tag keys are deliberately obscure to avoid
// colliding with a jsonb payload that happens to hold the same field.
//
//   - Date: a naive round-trip turns every `timestamp` column into a bare ISO
//     string, but downstream code calls `.toISOString()` / `.getTime()` on a
//     real Date: a cache hit would throw where a cache miss works.
//   - BigInt: `JSON.stringify` throws outright on a BigInt. Bun's SQL driver
//     returns `bigint`/`bigserial` columns as native BigInt (drizzle's
//     `mode:"number"` mapping runs AFTER the cache serializes the raw row), so
//     any query touching such a column (e.g. `deployment_log.seq`) would crash
//     the cache put and reject the query. Tag → toString, revive → BigInt so
//     the value stays exact and drizzle's column mapper still applies on read.
const DATE_TAG = "__otterCacheDate__";
const BIGINT_TAG = "__otterCacheBigInt__";

// Every Redis round-trip the cache makes goes through `cacheRedisCircuit`
// (./redis-circuit.ts): a 2 s deadline per call (a command in flight when the
// connection wedges can otherwise leave a promise that never settles, and
// because the cache sits in front of every query, that hangs the query, the
// request, and the page awaiting it), and a circuit breaker so a Redis
// outage costs a request one deadline rather than one per command. A skipped
// call is a cache miss / no-op; Postgres answers.

// `this` is the replacer's holder object: raw pre-serialization driver rows
// whose values include Dates and BigInts (runtime values, not JSON) so
// `JsonObject` would be dishonest here and `UnknownRecord` is the fit.
export function tagRichValues(this: UnknownRecord, key: string, value: unknown): unknown {
  // Date has a `toJSON`, so by the time the replacer sees `value` it's already
  // an ISO string: reach for the untouched original on `this`. BigInt has no
  // `toJSON`, so `value` is still the raw BigInt here.
  const original = this[key];
  if (original instanceof Date) {
    return { [DATE_TAG]: original.toISOString() };
  }
  if (typeof value === "bigint") {
    return { [BIGINT_TAG]: value.toString() };
  }
  return value;
}

export function reviveRichValues(_key: string, value: unknown): unknown {
  if (isJsonObject(value)) {
    const date = value[DATE_TAG];
    if (typeof date === "string") {
      return new Date(date);
    }
    const big = value[BIGINT_TAG];
    if (typeof big === "string") {
      return BigInt(big);
    }
  }
  return value;
}

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

    const result = await cacheRedisCircuit.run("cache GET", () => this.client.get(fullKey));
    if (result.isErr()) {
      if (RedisCircuitOpenError.is(result.error)) return undefined;
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
      const parsed: unknown = JSON.parse(raw, reviveRichValues);
      // Only query-result arrays are ever cached (put() serializes driver
      // rows); anything else is a corrupt/foreign key, so degrade to a miss.
      return Array.isArray(parsed) ? parsed : undefined;
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
    const value = JSON.stringify(response, tagRichValues);

    const setResult = await cacheRedisCircuit.run("cache SET", () =>
      this.client.set(fullKey, value, "EX", ttl),
    );
    if (setResult.isErr()) {
      if (RedisCircuitOpenError.is(setResult.error)) return;
      globalLog.warn({
        message: "[cache] Redis SET failed; skipping put",
        key: fullKey,
        error: setResult.error,
      });
      return;
    }

    for (const table of tables) {
      const setKey = TABLE_SET_PREFIX + table;
      const indexResult = await cacheRedisCircuit.run("cache table-index update", async () => {
        await this.client.sadd(setKey, fullKey);
        await this.client.expire(setKey, ttl * 2);
      });
      if (indexResult.isErr()) {
        if (RedisCircuitOpenError.is(indexResult.error)) return;
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
    const tags = Array.isArray(params.tags) ? params.tags : params.tags ? [params.tags] : [];
    const tableInputs = Array.isArray(params.tables)
      ? params.tables
      : params.tables
        ? [params.tables]
        : [];

    const tableNames = tableInputs.map((tableInput) =>
      // Explicit <Table> pins the return to `string`; drizzle's MutationOption
      // carries `Table<any>`, which would otherwise infer an `any` name.
      typeof tableInput === "string" ? tableInput : getTableName<Table>(tableInput),
    );

    // Endpoint-level API caches register themselves under the same dependency
    // tables. A Drizzle write therefore evicts both the SQL fragments and the
    // complete API response assembled from them.
    const setKeys = tableNames.flatMap((tableName) => [
      TABLE_SET_PREFIX + tableName,
      apiCacheTableSetKey(tableName),
    ]);
    const keysToDelete: string[] = [];

    if (setKeys.length > 0) {
      const [first, ...rest] = setKeys;
      // Forced: invalidation is attempted even while the circuit is open, a
      // skipped DEL could serve a stale read once Redis is back.
      const sunionResult = await cacheRedisCircuit.run(
        "cache SUNION",
        () => this.client.sunion(first ?? "", ...rest),
        { force: true },
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
      const delResult = await cacheRedisCircuit.run(
        "cache DEL",
        () => this.client.del(...keysToDelete),
        { force: true },
      );
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
