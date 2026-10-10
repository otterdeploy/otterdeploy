import type { CacheConfig } from "drizzle-orm/cache/core/types";

import { env } from "@otterdeploy/env/server";
import { type UnknownRecord, isJsonObject } from "@otterdeploy/shared/json";
import { getTableName, type Table } from "drizzle-orm";
import { Cache, type MutationOption } from "drizzle-orm/cache/core";
import { entityKind } from "drizzle-orm/entity";
import { log as globalLog } from "evlog";

import {
  CACHE_WRITE_SETTLE_MS,
  GEN_TTL_SECONDS,
  GET_SCRIPT,
  genKey,
  INVALIDATE_SCRIPT,
  parseGetReply,
  PUT_SCRIPT,
  ReadSnapshots,
  settleKey,
} from "./cache-coherence";
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
  /** Settle window after a write (ms); see CACHE_WRITE_SETTLE_MS. */
  settleMs?: number;
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
  private readonly settleMs: number;
  private readonly client: Bun.RedisClient;
  /** Counters each missed read saw, for its put (./cache-coherence.ts). */
  private readonly snapshots = new ReadSnapshots();

  constructor({
    ttl = 60,
    global = false,
    settleMs = CACHE_WRITE_SETTLE_MS,
  }: RedisCacheOptions = {}) {
    super();
    this.defaultTtl = ttl;
    this.useGlobally = global;
    this.settleMs = settleMs;
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
    tables: string[],
    isTag = false,
    _isAutoInvalidate?: boolean,
  ): Promise<unknown[] | undefined> {
    const fullKey = (isTag ? TAG_PREFIX : KEY_PREFIX) + key;

    const result = await cacheRedisCircuit.run("cache GET", () =>
      this.client.send("EVAL", [
        GET_SCRIPT,
        String(1 + tables.length),
        fullKey,
        ...tables.map((table) => genKey(table)),
      ]),
    );
    if (result.isErr()) {
      if (RedisCircuitOpenError.is(result.error)) return undefined;
      globalLog.warn({
        message: "[cache] Redis GET failed; treating as cache miss",
        key: fullKey,
        error: result.error,
      });
      return undefined;
    }

    const reply = parseGetReply(result.value);
    if (!reply) return undefined;
    if (!reply.hit) {
      this.snapshots.record(fullKey, tables, reply.gens);
      return undefined;
    }
    const raw = reply.value;
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
    // Always consumed; a value tied to no table is never stale: no checks.
    const snapshot = this.snapshots.take(fullKey, tables.length > 0);
    const genTables = snapshot?.tables ?? [];

    // One script: the value and its table-index entries land together or not
    // at all. As separate commands an invalidation could run between the SET
    // and the SADD and miss the key, leaving it served until its TTL. The
    // same step refuses a value a write may already have superseded.
    const setResult = await cacheRedisCircuit.run("cache SET", () =>
      this.client.send("EVAL", [
        PUT_SCRIPT,
        String(1 + tables.length + genTables.length + tables.length),
        fullKey,
        ...tables.map((table) => TABLE_SET_PREFIX + table),
        ...genTables.map((table) => genKey(table)),
        ...tables.map((table) => settleKey(table)),
        value,
        String(ttl),
        String(ttl * 2),
        String(tables.length),
        String(genTables.length),
        String(tables.length),
        ...(snapshot?.gens ?? []),
      ]),
    );
    if (setResult.isErr()) {
      if (RedisCircuitOpenError.is(setResult.error)) return;
      globalLog.warn({
        message: "[cache] Redis SET failed; skipping put",
        key: fullKey,
        error: setResult.error,
      });
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
    const tagKeys = tags.map((tag) => TAG_PREFIX + tag);
    if (setKeys.length === 0 && tagKeys.length === 0) return;
    const genKeys = tableNames.map((tableName) => genKey(tableName));
    const dirtyKeys = tableNames.map((tableName) => settleKey(tableName));

    // One script: collect every key indexed under these tables and delete it
    // with the indexes in a single step. As separate SUNION and DEL calls, a
    // put landing between them had its index entry deleted with the set while
    // its value survived, unreachable by any later invalidation: a stale read
    // for the whole TTL (a just-saved manifest read back as the empty one for
    // ~60 s). Forced: invalidation is attempted even while the
    // circuit is open, a skipped DEL could serve a stale read once Redis is
    // back.
    const invalidated = await cacheRedisCircuit.run(
      "cache INVALIDATE",
      () =>
        this.client.send("EVAL", [
          INVALIDATE_SCRIPT,
          String(setKeys.length + tagKeys.length + genKeys.length + dirtyKeys.length),
          ...setKeys,
          ...tagKeys,
          ...genKeys,
          ...dirtyKeys,
          String(setKeys.length),
          String(tagKeys.length),
          String(tableNames.length),
          String(this.settleMs),
          String(GEN_TTL_SECONDS),
        ]),
      { force: true },
    );
    if (invalidated.isErr()) {
      globalLog.warn({
        message: "[cache] Redis invalidation failed",
        tables: tableNames,
        error: invalidated.error,
      });
    }
  }
}

export function redisCache(options: RedisCacheOptions = {}): RedisCache {
  return new RedisCache(options);
}
