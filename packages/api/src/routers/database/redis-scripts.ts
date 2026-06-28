/**
 * Lua scripts + EVAL-payload parsing for the Redis data-viewer engine. The
 * browse/scan/value reads are issued as small Lua scripts via EVAL that return
 * `cjson.encode(...)`, so we get one round-trip and structured JSON instead of
 * parsing redis-cli's human output. Pure reads only — read-only by construction.
 */
import { QueryError } from "./query";

/** Sentinel a script returns when a value/key can't be cjson-encoded (binary
 *  bytes that aren't valid UTF-8). Surfaced to the caller as a clear error
 *  rather than a parse failure. */
export const ENC_ERR = "__OTTER_ENCERR__";

/** Cap on string-value bytes pulled back to the UI (large blobs stay capped). */
export const STRING_CAP = 100_000;

// SCAN one page, then TYPE + TTL for each key. Pure reads, so SCAN-then-read is
// allowed in a script. KEYS=[], ARGV=[cursor, match, count].
export const SCAN_SCRIPT = `
local res = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', tonumber(ARGV[3]))
local keys = res[2]
local out = {}
for i = 1, #keys do
  local k = keys[i]
  local ti = redis.call('TYPE', k)
  out[i] = { name = k, type = (type(ti) == 'table' and ti.ok or ti), ttl = redis.call('TTL', k) }
end
local ok, enc = pcall(cjson.encode, { cursor = res[1], keys = out })
if ok then return enc else return '${ENC_ERR}' end
`.trim();

// Read one key's value, shaped by its type and capped. KEYS=[], ARGV=[key, limit].
export const VALUE_SCRIPT = `
local key = ARGV[1]
local limit = tonumber(ARGV[2])
local ti = redis.call('TYPE', key)
local t = (type(ti) == 'table' and ti.ok or ti)
local p = { type = t, ttl = redis.call('TTL', key), length = 0 }
if t == 'string' then
  p.length = redis.call('STRLEN', key)
  p.value = redis.call('GETRANGE', key, 0, ${STRING_CAP - 1})
elseif t == 'list' then
  p.length = redis.call('LLEN', key)
  p.value = redis.call('LRANGE', key, 0, limit - 1)
elseif t == 'set' then
  p.length = redis.call('SCARD', key)
  local m = redis.call('SMEMBERS', key)
  local s = {}
  for i = 1, math.min(#m, limit) do s[i] = m[i] end
  p.value = s
elseif t == 'hash' then
  p.length = redis.call('HLEN', key)
  local h = redis.call('HGETALL', key)
  local s = {}
  for i = 1, math.min(#h, limit * 2) do s[i] = h[i] end
  p.value = s
elseif t == 'zset' then
  p.length = redis.call('ZCARD', key)
  p.value = redis.call('ZRANGE', key, 0, limit - 1, 'WITHSCORES')
elseif t == 'stream' then
  p.length = redis.call('XLEN', key)
  p.value = redis.call('XRANGE', key, '-', '+', 'COUNT', limit)
end
local ok, enc = pcall(cjson.encode, p)
if ok then return enc else return '${ENC_ERR}' end
`.trim();

/** Run an EVAL whose script returns `cjson.encode(...)`, parse the JSON. */
export function parseEval<T>(raw: string): T {
  const trimmed = raw.trim();
  if (trimmed === ENC_ERR) {
    throw new QueryError("value contains non-UTF-8 data that can't be previewed");
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new QueryError(trimmed || "empty response from redis");
  }
}
