/**
 * What keeps the query cache (./cache.ts) from storing a value a write has
 * already superseded.
 *
 * Drizzle calls `get` (miss), runs the query, then `put`; and it runs a
 * write's invalidation CONCURRENTLY with the write statement (inside a
 * transaction, before the commit). Two interleavings used to cache a stale
 * row for the whole TTL:
 *
 *   1. read queries the old row, the write lands and invalidates, the read's
 *      put arrives after the invalidation;
 *   2. the invalidation runs first, a read queries before the write commits,
 *      and its put arrives after.
 *
 * Every invalidation bumps a per-table write counter (1) and opens a short
 * per-table settle window (2). A missed read snapshots the counters in the
 * same Redis step as the miss; its put lands only if no counter moved and no
 * table is inside its window, in the same step as the SET.
 */

const GEN_PREFIX = "drizzle:cache:gen:";
const DIRTY_PREFIX = "drizzle:cache:dirty:";

/** Per-table write counter, bumped by every invalidation. */
export const genKey = (table: string): string => GEN_PREFIX + table;
/** Per-table marker, present for the settle window after an invalidation. */
export const settleKey = (table: string): string => DIRTY_PREFIX + table;

/**
 * How long after a write to a table no read of it may be cached. Reads in the
 * window still answer from Postgres; they just do not populate the cache.
 */
export const CACHE_WRITE_SETTLE_MS = 5_000;

/** Write counters outlive any read that could still be holding a snapshot. */
export const GEN_TTL_SECONDS = 24 * 60 * 60;

/** A snapshot whose put never came (the query threw) is dropped after this. */
const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const SNAPSHOT_SWEEP_SIZE = 1_000;

/**
 * KEYS[1] = the cache key, KEYS[2..] = the write counters of the tables it
 * reads. A hit answers {1, value}; a miss answers {0, counter...}: the
 * snapshot `put` checks against, read in the same step as the miss.
 */
export const GET_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then return {1, value} end
local out = {0}
for i = 2, #KEYS do
  out[i] = redis.call('GET', KEYS[i]) or '0'
end
return out
`;

/**
 * KEYS[1] = the cache key, then ARGV[4] table-index sets, ARGV[5] write
 * counters, ARGV[6] settle markers. ARGV[1..3] = value, ttl, index ttl;
 * ARGV[7..] = the counters the read saw before it queried.
 *
 * Refuses (returns 0) when a table the value was read from was written since
 * the read's snapshot, or is still inside its settle window. Otherwise
 * SET + SADD + EXPIRE as one atomic step.
 */
export const PUT_SCRIPT = `
local nIndex = tonumber(ARGV[4])
local nGen = tonumber(ARGV[5])
local nDirty = tonumber(ARGV[6])
local genBase = 1 + nIndex
for i = 1, nGen do
  local current = redis.call('GET', KEYS[genBase + i]) or '0'
  if current ~= ARGV[6 + i] then return 0 end
end
local dirtyBase = genBase + nGen
for i = 1, nDirty do
  if redis.call('EXISTS', KEYS[dirtyBase + i]) == 1 then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
for i = 2, 1 + nIndex do
  redis.call('SADD', KEYS[i], KEYS[1])
  redis.call('EXPIRE', KEYS[i], ARGV[3])
end
return 1
`;

/**
 * KEYS = ARGV[1] table-index sets, ARGV[2] tag keys, then ARGV[3] write
 * counters and ARGV[3] settle markers (one of each per table).
 * ARGV[4] = settle window (ms), ARGV[5] = counter ttl (s).
 * Bumps each table's counter and opens its settle window, then deletes every
 * key indexed under the sets, the sets, and the tags, atomically.
 * DEL is chunked to stay under Lua's unpack() limit.
 */
export const INVALIDATE_SCRIPT = `
local n = tonumber(ARGV[1])
local m = tonumber(ARGV[2])
local t = tonumber(ARGV[3])
for i = 1, t do
  redis.call('INCR', KEYS[n + m + i])
  redis.call('EXPIRE', KEYS[n + m + i], ARGV[5])
  redis.call('SET', KEYS[n + m + t + i], '1', 'PX', ARGV[4])
end
local doomed = {}
if n > 0 then doomed = redis.call('SUNION', unpack(KEYS, 1, n)) end
for i = 1, #doomed, 1000 do
  redis.call('DEL', unpack(doomed, i, math.min(i + 999, #doomed)))
end
if n + m > 0 then redis.call('DEL', unpack(KEYS, 1, n + m)) end
return #doomed
`;

/** Parse GET_SCRIPT's reply. `undefined` = a reply of an unexpected shape. */
export function parseGetReply(
  reply: unknown,
): { hit: true; value: string } | { hit: false; gens: string[] } | undefined {
  if (!Array.isArray(reply)) return undefined;
  const [flag, ...rest] = reply;
  if (flag === 1 && typeof rest[0] === "string") return { hit: true, value: rest[0] };
  if (flag !== 0) return undefined;
  return { hit: false, gens: rest.map((gen) => (typeof gen === "string" ? gen : String(gen))) };
}

/** The write counters a missed read saw, held until its put. */
export interface ReadSnapshot {
  tables: string[];
  gens: string[];
  readers: number;
  takenAt: number;
}

/**
 * Snapshots taken by missed reads, by cache key, consumed by their put.
 * Nothing links drizzle's get to its put but the key, so concurrent misses on
 * one key share an entry holding the OLDEST counter per table: no put can use
 * a snapshot newer than its own read (the cost: the newer read's put may be
 * refused too, which is only a missed fill).
 */
export class ReadSnapshots {
  private readonly held = new Map<string, ReadSnapshot>();

  record(key: string, tables: string[], gens: string[]): void {
    const now = performance.now();
    if (this.held.size >= SNAPSHOT_SWEEP_SIZE) {
      for (const [k, snapshot] of this.held)
        if (now - snapshot.takenAt > SNAPSHOT_MAX_AGE_MS) this.held.delete(k);
    }
    const existing = this.held.get(key);
    if (!existing || existing.tables.join("\0") !== tables.join("\0")) {
      this.held.set(key, { tables, gens, readers: 1, takenAt: now });
      return;
    }
    existing.gens = existing.gens.map((gen, i) => {
      const seen = gens[i];
      return seen !== undefined && Number(seen) < Number(gen) ? seen : gen;
    });
    existing.readers += 1;
  }

  /** Consume one reader's share; `use: false` drops it without returning it. */
  take(key: string, use = true): ReadSnapshot | undefined {
    const existing = this.held.get(key);
    if (!existing) return undefined;
    existing.readers -= 1;
    if (existing.readers <= 0) this.held.delete(key);
    return use ? existing : undefined;
  }
}
