/**
 * Data viewer oRPC contract (docs/designs/data-viewer.md). A read-first SQL
 * console + grid over a provisioned database resource. v1 is postgres-only and
 * runs every statement in a read-only session (writes error at the server);
 * the write path is gated behind a separate permission for a later phase.
 */
import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import { orgCatalogInput, orgCatalogResultSchema } from "./contract-catalog";
import {
  ephemeralCreateInput,
  ephemeralCreateResultSchema,
  ephemeralListInput,
  ephemeralListResultSchema,
  ephemeralRevokeInput,
  ephemeralRevokeResultSchema,
  makeNotEphemeral,
} from "./contract-ephemeral";
import { hostListInput, hostListResultSchema } from "./contract-hosts";

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

const connectionsInput = z.object({ resourceId: resourceIdField });

/** One group of live client sessions sharing an origin. `clientAddr` is the
 *  raw address postgres sees. A container/overlay IP for in-cluster
 *  clients, so `applicationName` (when the client sets it) is often the more
 *  human column. */
const connectionGroupSchema = z.object({
  clientAddr: z.string(),
  user: z.string(),
  applicationName: z.string(),
  state: z.string(),
  count: z.number().int(),
});

const connectionsResultSchema = z.object({
  /** current_setting('max_connections'); null when unparseable. */
  maxConnections: z.number().int().nullable(),
  groups: z.array(connectionGroupSchema),
});

// ── Redis (key-value) ──────────────────────────────────────────────────────
// Redis has no tables/SQL, so it gets its own native browse contract: a
// keyspace overview, a cursor-paged key list, and a per-type value read. All
// read-only. There is no arbitrary-command input.

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
  // SCAN cursor: "0" starts a fresh sweep; the result's cursor continues it.
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

// ── MongoDB (document store, read-only browser) ─────────────────────────────

const mongoCollectionsInput = z.object({ resourceId: resourceIdField });

const mongoCollectionsResultSchema = z.object({
  collections: z.array(z.object({ name: z.string(), count: z.number() })),
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
  // Live client sessions grouped by origin. A monitoring probe over
  // pg_stat_activity, not a data-browsing procedure — which is why it stayed
  // here when the viewer moved to `data.*`.
  connections: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/connections`, tag, method: "GET" })
    .input(connectionsInput)
    .output(connectionsResultSchema),

  // Org-wide catalog: every database resource across the org's projects with
  // runtime status, endpoints, last-backup freshness, and best-effort live
  // stats. Backs the /$org/databases page. `list`-prefixed so the audit
  // middleware and read-only API keys classify it as a read.
  listOrgCatalog: oc
    .meta({ path: `${basePath}/catalog`, tag, method: "GET" })
    .input(orgCatalogInput)
    .output(orgCatalogResultSchema),

  // Database servers that can host another logical database, with the live
  // connection budget and the tenants already on each. Backs the create
  // flow's "put this on an existing server" step.
  listHosts: oc
    .meta({ path: `${basePath}/hosts`, tag, method: "GET" })
    .input(hostListInput)
    .output(hostListResultSchema),

  // ── Ephemeral credentials ────────────────────────────────────────────────
  // Mint a short-lived connection URL (auto-disposed at the TTL).
  ephemeralCreate: oc
    .errors(makeNotEphemeral(notDatabase))
    .meta({ path: `${basePath}/{resourceId}/ephemeral`, tag, method: "POST" })
    .input(ephemeralCreateInput)
    .output(ephemeralCreateResultSchema),

  // Active + past credentials for the resource (no secrets, audit view).
  ephemeralList: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/ephemeral`, tag, method: "GET" })
    .input(ephemeralListInput)
    .output(ephemeralListResultSchema),

  // Dispose a credential now: terminate its sessions and drop the role.
  ephemeralRevoke: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/ephemeral/revoke`, tag, method: "POST" })
    .input(ephemeralRevokeInput)
    .output(ephemeralRevokeResultSchema),

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
