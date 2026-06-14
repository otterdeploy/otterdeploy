/**
 * Data viewer oRPC contract (docs/designs/data-viewer.md). A read-first SQL
 * console + grid over a provisioned database resource. v1 is postgres-only and
 * runs every statement in a read-only session (writes error at the server);
 * the write path is gated behind a separate permission for a later phase.
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

const tag = "database";
const basePath = "/database";

const resourceIdField = zId(ID_PREFIX.resource);

const notDatabase = {
  NOT_FOUND: { status: 404 as const, message: "Database not found" as const },
  UNSUPPORTED: {
    status: 422 as const,
    message: "Engine not supported by the data viewer yet" as const,
  },
  QUERY_FAILED: {
    status: 422 as const,
    message: "Query failed" as const,
    data: z.object({ reason: z.string() }),
  },
};

export const queryInput = z.object({
  resourceId: resourceIdField,
  sql: z.string().min(1).max(100_000),
  // Hard cap on returned rows (UI grid). The engine still streams the full
  // result from psql, then truncates — fine for a console, not for exports.
  limit: z.number().int().positive().max(5000).default(200),
});

export const queryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  rowCount: z.number(),
  truncated: z.boolean(),
  durationMs: z.number(),
});

export const tablesInput = z.object({ resourceId: resourceIdField });

export const tablesResultSchema = z.object({
  tables: z.array(
    z.object({ schema: z.string(), name: z.string() }),
  ),
});

// ── Redis (key-value) ──────────────────────────────────────────────────────
// Redis has no tables/SQL, so it gets its own native browse contract: a
// keyspace overview, a cursor-paged key list, and a per-type value read. All
// read-only — there is no arbitrary-command input.

export const redisKeyspaceInput = z.object({ resourceId: resourceIdField });

export const redisKeyspaceResultSchema = z.object({
  databases: z.array(
    z.object({
      index: z.number(),
      keys: z.number(),
      expires: z.number(),
    }),
  ),
});

export const redisKeysInput = z.object({
  resourceId: resourceIdField,
  db: z.number().int().min(0).max(63).default(0),
  // SCAN MATCH glob (e.g. `user:*`). Defaults to all keys.
  match: z.string().min(1).max(200).default("*"),
  // SCAN cursor — "0" starts a fresh sweep; the result's cursor continues it.
  cursor: z.string().default("0"),
  count: z.number().int().positive().max(1000).default(200),
});

export const redisKeysResultSchema = z.object({
  cursor: z.string(),
  keys: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      // TTL seconds; -1 = no expiry, -2 = missing.
      ttl: z.number(),
    }),
  ),
});

export const redisValueInput = z.object({
  resourceId: resourceIdField,
  db: z.number().int().min(0).max(63).default(0),
  key: z.string().min(1).max(10_000),
  // Element cap for collection types (list/set/hash/zset/stream).
  limit: z.number().int().positive().max(5000).default(500),
});

export const redisValueResultSchema = z.object({
  key: z.string(),
  type: z.enum(["string", "list", "set", "hash", "zset", "stream", "none"]),
  ttl: z.number(),
  // strlen for strings, element count for collections.
  length: z.number(),
  truncated: z.boolean(),
  binary: z.boolean(),
  // Exactly one of `string` / `rows` is populated (per `type`).
  string: z.string().nullable(),
  rows: z
    .object({
      columns: z.array(z.string()),
      cells: z.array(z.array(z.string())),
    })
    .nullable(),
});

export const databaseContract = {
  // List user tables in the database (excludes catalog/system schemas).
  tables: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/tables`, tag, method: "GET" })
    .input(tablesInput)
    .output(tablesResultSchema),

  // Run a read-only SQL statement and return the grid.
  query: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/query`, tag, method: "POST" })
    .input(queryInput)
    .output(queryResultSchema),

  // ── Redis ────────────────────────────────────────────────────────────────
  // Per-database key counts (the db picker).
  redisKeyspace: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/redis/keyspace`, tag, method: "GET" })
    .input(redisKeyspaceInput)
    .output(redisKeyspaceResultSchema),

  // One SCAN page of keys (with type + TTL) for the key browser.
  redisKeys: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/redis/keys`, tag, method: "GET" })
    .input(redisKeysInput)
    .output(redisKeysResultSchema),

  // Read one key's value (string or normalized grid), capped by `limit`.
  redisValue: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/redis/value`, tag, method: "POST" })
    .input(redisValueInput)
    .output(redisValueResultSchema),
};
