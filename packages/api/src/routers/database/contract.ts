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

// The write path adds one more failure mode: a row mutation that can't be
// safely targeted because the table has no primary key (we refuse rather than
// guess with `ctid`, which the read path never exposes).
const notMutable = {
  ...notDatabase,
  NO_PRIMARY_KEY: {
    status: 422 as const,
    message: "Table has no primary key, so rows can't be edited safely" as const,
  },
};

const queryInput = z.object({
  resourceId: resourceIdField,
  sql: z.string().min(1).max(100_000),
  // Hard cap on returned rows (UI grid). The engine still streams the full
  // result from psql, then truncates — fine for a console, not for exports.
  limit: z.number().int().positive().max(5000).default(200),
});

const queryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  rowCount: z.number(),
  truncated: z.boolean(),
  durationMs: z.number(),
});

const tablesInput = z.object({ resourceId: resourceIdField });

const tablesResultSchema = z.object({
  tables: z.array(
    z.object({ schema: z.string(), name: z.string() }),
  ),
});

// ── Write path (Phase 2) ────────────────────────────────────────────────────
// Structured row mutations that back inline grid editing — the SERVER builds
// the SQL from this shape (never trusting a client-sent statement) so writes
// stay primary-key-guarded and gated by the `database:write` capability.

/** One column predicate / assignment. `value: null` is SQL NULL. */
const columnValue = z.object({
  column: z.string().min(1).max(255),
  value: z.string().nullable(),
});

const mutateRowInput = z.object({
  resourceId: resourceIdField,
  schema: z.string().min(1).max(255),
  table: z.string().min(1).max(255),
  op: z.enum(["update", "insert", "delete"]),
  // Identifies the target row (required for update/delete). Every primary-key
  // column, so exactly one row is matched.
  pk: z.array(columnValue).default([]),
  // Column assignments (required for update/insert).
  set: z.array(columnValue).default([]),
});

const mutateRowResultSchema = z.object({
  // The affected row(s), from `RETURNING *` — shaped like a query grid so the
  // client can reconcile its in-memory row. 0 rows = the predicate matched none.
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  rowsAffected: z.number(),
});

const capabilitiesInput = z.object({ resourceId: resourceIdField });

const capabilitiesResultSchema = z.object({
  // Whether the current actor may mutate data (drives read-only vs editable UI;
  // the write handlers enforce it server-side regardless).
  canWrite: z.boolean(),
});

// ── Redis (key-value) ──────────────────────────────────────────────────────
// Redis has no tables/SQL, so it gets its own native browse contract: a
// keyspace overview, a cursor-paged key list, and a per-type value read. All
// read-only — there is no arbitrary-command input.

const redisKeyspaceInput = z.object({ resourceId: resourceIdField });

const redisKeyspaceResultSchema = z.object({
  databases: z.array(
    z.object({
      index: z.number(),
      keys: z.number(),
      expires: z.number(),
    }),
  ),
});

const redisKeysInput = z.object({
  resourceId: resourceIdField,
  db: z.number().int().min(0).max(63).default(0),
  // SCAN MATCH glob (e.g. `user:*`). Defaults to all keys.
  match: z.string().min(1).max(200).default("*"),
  // SCAN cursor — "0" starts a fresh sweep; the result's cursor continues it.
  cursor: z.string().default("0"),
  count: z.number().int().positive().max(1000).default(200),
});

const redisKeysResultSchema = z.object({
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

const redisValueInput = z.object({
  resourceId: resourceIdField,
  db: z.number().int().min(0).max(63).default(0),
  key: z.string().min(1).max(10_000),
  // Element cap for collection types (list/set/hash/zset/stream).
  limit: z.number().int().positive().max(5000).default(500),
});

const redisValueResultSchema = z.object({
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

// ── MariaDB / MySQL (relational, read-only table browser) ───────────────────
// Like Postgres but with no free-text console: list tables, then page a table's
// rows. Every statement is server-built, so it's read-only by construction.

const mariadbTablesInput = z.object({ resourceId: resourceIdField });

const mariadbBrowseInput = z.object({
  resourceId: resourceIdField,
  schema: z.string().min(1).max(255),
  table: z.string().min(1).max(255),
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().min(0).default(0),
});

const mariadbGridSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  // Another page exists (fetched limit + 1).
  hasMore: z.boolean(),
});

// ── MongoDB (document store, read-only browser) ─────────────────────────────

const mongoCollectionsInput = z.object({ resourceId: resourceIdField });

const mongoCollectionsResultSchema = z.object({
  collections: z.array(
    z.object({ name: z.string(), count: z.number() }),
  ),
});

const mongoDocumentsInput = z.object({
  resourceId: resourceIdField,
  collection: z.string().min(1).max(255),
  limit: z.number().int().positive().max(500).default(50),
  skip: z.number().int().min(0).default(0),
});

const mongoDocumentsResultSchema = z.object({
  // Each document as a pretty Extended-JSON string.
  docs: z.array(z.string()),
  hasMore: z.boolean(),
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

  // Run ARBITRARY SQL (DML/DDL) without the read-only envelope. Requires the
  // `database:write` capability; every call is audited. Same grid shape as
  // `query` — rowCount doubles as rows-affected for INSERT/UPDATE/DELETE.
  execute: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/execute`, tag, method: "POST" })
    .input(queryInput)
    .output(queryResultSchema),

  // What the current actor may do against this database (read-only vs editable).
  capabilities: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/capabilities`, tag, method: "GET" })
    .input(capabilitiesInput)
    .output(capabilitiesResultSchema),

  // Mutate a single row (insert/update/delete), primary-key-guarded. Requires
  // the `database:write` capability.
  mutateRow: oc
    .errors(notMutable)
    .meta({ path: `${basePath}/{resourceId}/mutate-row`, tag, method: "POST" })
    .input(mutateRowInput)
    .output(mutateRowResultSchema),

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

  // ── MariaDB ──────────────────────────────────────────────────────────────
  // List user tables.
  mariadbTables: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/mariadb/tables`, tag, method: "GET" })
    .input(mariadbTablesInput)
    .output(tablesResultSchema),

  // Page through a table's rows.
  mariadbRows: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/mariadb/rows`, tag, method: "GET" })
    .input(mariadbBrowseInput)
    .output(mariadbGridSchema),

  // ── MongoDB ──────────────────────────────────────────────────────────────
  // List collections with estimated counts.
  mongoCollections: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/mongo/collections`, tag, method: "GET" })
    .input(mongoCollectionsInput)
    .output(mongoCollectionsResultSchema),

  // Page through a collection's documents.
  mongoDocuments: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/mongo/documents`, tag, method: "GET" })
    .input(mongoDocumentsInput)
    .output(mongoDocumentsResultSchema),
};
