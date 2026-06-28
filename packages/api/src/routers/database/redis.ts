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
 * script via EVAL that returns `cjson.encode(...)` (see redis-scripts.ts), so we
 * get one round-trip and structured JSON instead of parsing redis-cli's human
 * output. Only read commands are ever issued and there is no arbitrary-command
 * input, so the viewer is read-only by construction.
 */
import { Docker } from "@otterdeploy/docker";

import type { RedisKey, RedisKeyspaceEntry, RedisValue } from "./redis-types";

import { execCapture, findServiceContainerId } from "../../backups/exec";
import { buildContainerName } from "../project/views";
import { type DbConnInfo, QueryError, UnsupportedEngineError } from "./query";
import { parseEval, SCAN_SCRIPT, VALUE_SCRIPT } from "./redis-scripts";
import { shapeValue } from "./redis-shape";

export type { RedisKey, RedisKeyspaceEntry, RedisValue } from "./redis-types";

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

// ── public API ──────────────────────────────────────────────────────────────

/** Per-database key counts from `INFO keyspace` (only non-empty dbs appear). */
export async function redisKeyspace(conn: DbConnInfo): Promise<RedisKeyspaceEntry[]> {
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
    return shapeValue(opts.key, p);
  });
}
