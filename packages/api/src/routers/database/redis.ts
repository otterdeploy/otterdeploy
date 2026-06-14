/**
 * Redis data-viewer engine. The relational viewer's psql path doesn't map onto
 * Redis (no tables, no SQL, no read-only transaction mode), so Redis gets its
 * own native browser: a keyspace overview, a SCAN-based key list, and a
 * per-type value reader.
 *
 * Everything runs inside the database's own task container via the same Docker
 * exec channel the backup engine uses — we never connect over the overlay
 * network, so creds stay off the wire (see backups/exec.ts). Commands go
 * through `redis-cli`. The browse/scan/value reads are issued as a small Lua
 * script via EVAL that returns `cjson.encode(...)`, so we get one round-trip
 * and structured JSON instead of parsing redis-cli's human output. Only read
 * commands are ever issued and there is no arbitrary-command input, so the
 * viewer is read-only by construction.
 */
import { Docker } from "@otterdeploy/docker";

import { execCapture, findServiceContainerId } from "../../backups/exec";
import { buildContainerName } from "../project/views";
import {
  type DbConnInfo,
  QueryError,
  UnsupportedEngineError,
} from "./query";

/** Sentinel a script returns when a value/key can't be cjson-encoded (binary
 *  bytes that aren't valid UTF-8). Surfaced to the caller as a clear error
 *  rather than a parse failure. */
const ENC_ERR = "__OTTER_ENCERR__";

/** Cap on string-value bytes pulled back to the UI (large blobs stay capped). */
const STRING_CAP = 100_000;

export interface RedisKey {
  name: string;
  type: string;
  ttl: number;
}

export interface RedisKeyspaceEntry {
  index: number;
  keys: number;
  expires: number;
}

export interface RedisValue {
  key: string;
  type: "string" | "list" | "set" | "hash" | "zset" | "stream" | "none";
  ttl: number;
  length: number;
  truncated: boolean;
  binary: boolean;
  string: string | null;
  rows: { columns: string[]; cells: string[][] } | null;
}

// ── redis-cli plumbing ──────────────────────────────────────────────────────

/** Resolve the running container backing a Redis resource, asserting engine. */
async function withRedisContainer<T>(
  conn: DbConnInfo,
  fn: (run: (cmd: string[]) => Promise<string>) => Promise<T>,
): Promise<T> {
  if (conn.engine !== "redis") throw new UnsupportedEngineError(conn.engine);
  const docker = Docker.fromEnv();
  try {
    const serviceName = buildContainerName({
      engine: conn.engine,
      projectSlug: conn.projectSlug,
      resourceName: conn.resourceName,
    });
    const containerId = await findServiceContainerId(docker, serviceName);
    if (!containerId) {
      throw new QueryError(`redis container for ${serviceName} is not running`);
    }

    // `--no-auth-warning` keeps the command-line-auth notice out of stderr.
    const base = ["redis-cli", "--no-auth-warning", "-a", conn.password];
    const run = async (cmd: string[]) => {
      const result = await execCapture(docker, containerId, [...base, ...cmd], {
        allowNonZero: true,
      });
      const out = result.stdout;
      // redis-cli reports command/script errors on stdout as `(error) …` and
      // doesn't always set a non-zero exit; treat either as a failure.
      if (result.exitCode !== 0 || out.startsWith("(error)")) {
        const reason =
          out.startsWith("(error)") && out.trim()
            ? out.trim().slice("(error)".length).trim()
            : result.stderr.trim() || out.trim() || "redis command failed";
        throw new QueryError(reason);
      }
      return out;
    };

    return await fn(run);
  } finally {
    docker.destroy();
  }
}

/** Run an EVAL whose script returns `cjson.encode(...)`, parse the JSON. */
function parseEval<T>(raw: string): T {
  const trimmed = raw.trim();
  if (trimmed === ENC_ERR) {
    throw new QueryError(
      "value contains non-UTF-8 data that can't be previewed",
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new QueryError(trimmed || "empty response from redis");
  }
}

// ── Lua scripts ─────────────────────────────────────────────────────────────

// SCAN one page, then TYPE + TTL for each key. Pure reads, so SCAN-then-read is
// allowed in a script. KEYS=[], ARGV=[cursor, match, count].
const SCAN_SCRIPT = `
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
const VALUE_SCRIPT = `
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

// ── public API ──────────────────────────────────────────────────────────────

/** Per-database key counts from `INFO keyspace` (only non-empty dbs appear). */
export async function redisKeyspace(
  conn: DbConnInfo,
): Promise<RedisKeyspaceEntry[]> {
  return withRedisContainer(conn, async (run) => {
    const out = await run(["INFO", "keyspace"]);
    const entries: RedisKeyspaceEntry[] = [];
    // Lines look like: db0:keys=120,expires=2,avg_ttl=0
    for (const line of out.split("\n")) {
      const m = line.match(/^db(\d+):keys=(\d+),expires=(\d+)/);
      if (m) {
        entries.push({
          index: Number(m[1]),
          keys: Number(m[2]),
          expires: Number(m[3]),
        });
      }
    }
    return entries;
  });
}

/** One SCAN page over a db, each key carrying its type + TTL. */
export async function redisScanKeys(
  conn: DbConnInfo,
  opts: { db: number; match: string; cursor: string; count: number },
): Promise<{ cursor: string; keys: RedisKey[] }> {
  return withRedisContainer(conn, async (run) => {
    const out = await run([
      "-n",
      String(opts.db),
      "EVAL",
      SCAN_SCRIPT,
      "0",
      opts.cursor,
      opts.match,
      String(opts.count),
    ]);
    const parsed = parseEval<{ cursor: string; keys?: RedisKey[] }>(out);
    return {
      cursor: String(parsed.cursor ?? "0"),
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
    };
  });
}

/** Read a single key's value, normalized into a string or a columns/cells grid. */
export async function redisReadValue(
  conn: DbConnInfo,
  opts: { db: number; key: string; limit: number },
): Promise<RedisValue> {
  return withRedisContainer(conn, async (run) => {
    const out = await run([
      "-n",
      String(opts.db),
      "EVAL",
      VALUE_SCRIPT,
      "0",
      opts.key,
      String(opts.limit),
    ]);
    const p = parseEval<{
      type: RedisValue["type"];
      ttl: number;
      length: number;
      value?: unknown;
    }>(out);
    return shapeValue(opts.key, p, opts.limit);
  });
}

/** Turn the raw script payload into the viewer's string-or-grid contract. */
function shapeValue(
  key: string,
  p: { type: RedisValue["type"]; ttl: number; length: number; value?: unknown },
  limit: number,
): RedisValue {
  const base = {
    key,
    type: p.type,
    ttl: p.ttl,
    length: p.length,
    binary: false,
    string: null as string | null,
    rows: null as RedisValue["rows"],
  };

  const arr = Array.isArray(p.value) ? (p.value as unknown[]).map(String) : [];

  switch (p.type) {
    case "string": {
      const s = typeof p.value === "string" ? p.value : "";
      return { ...base, string: s, truncated: p.length > s.length };
    }
    case "list":
      return {
        ...base,
        rows: {
          columns: ["#", "value"],
          cells: arr.map((v, i) => [String(i), v]),
        },
        truncated: p.length > arr.length,
      };
    case "set":
      return {
        ...base,
        rows: { columns: ["value"], cells: arr.map((v) => [v]) },
        truncated: p.length > arr.length,
      };
    case "hash":
      return {
        ...base,
        rows: { columns: ["field", "value"], cells: chunkPairs(arr) },
        truncated: p.length > Math.floor(arr.length / 2),
      };
    case "zset":
      // ZRANGE WITHSCORES is flat [member, score, …]; show score first.
      return {
        ...base,
        rows: {
          columns: ["member", "score"],
          cells: chunkPairs(arr),
        },
        truncated: p.length > Math.floor(arr.length / 2),
      };
    case "stream": {
      // Each entry is [id, [field, value, …]].
      const entries = Array.isArray(p.value) ? (p.value as unknown[]) : [];
      const cells = entries.map((e) => {
        const [id, fields] = Array.isArray(e) ? e : [String(e), []];
        const fieldArr = Array.isArray(fields) ? fields.map(String) : [];
        const pairs: Record<string, string> = {};
        for (let i = 0; i + 1 < fieldArr.length; i += 2) {
          pairs[fieldArr[i] as string] = fieldArr[i + 1] as string;
        }
        return [String(id), JSON.stringify(pairs)];
      });
      return {
        ...base,
        rows: { columns: ["id", "fields"], cells },
        truncated: p.length > cells.length,
      };
    }
    default:
      // "none" — key missing or expired between list and read.
      return { ...base, truncated: false };
  }
}

/** Split a flat [a, b, a, b, …] array into [[a, b], …] rows. */
function chunkPairs(flat: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push([flat[i] as string, flat[i + 1] as string]);
  }
  return out;
}
