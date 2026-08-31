/**
 * The `data.*` contract: the typed replacement for `database.query` / `.tables`.
 *
 * Added ALONGSIDE the existing `database.*` procedures rather than replacing
 * them, so this PR changes no behaviour the web app can see. The app migrates
 * next, and `database.query` / `.tables` / `.execute` / `.mutateRow` are deleted
 * once nothing calls them.
 *
 * The shape difference that matters: `database.query` returns
 * `rows: Array<Array<string | null>>`, in which SQL NULL and the empty string
 * are the same value. Here a row is `CellValue[]`, where JSON `null` means NULL
 * and nothing else does.
 */
import { oc } from "@orpc/contract";
import {
  columnSchema,
  filterSchema,
  gridSchema,
  mutationSchema,
  sortSchema,
} from "@otterdeploy/data-engine";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const tag = "data";
const basePath = "/data";

const resourceIdField = zId(ID_PREFIX.resource);

/**
 * Failure modes, mapped from the runtime's tagged reasons.
 *
 * `QUERY_FAILED` carries the engine's own message verbatim: a SQL console that
 * replaces "column \"stauts\" does not exist" with "query failed" has thrown
 * away the only part the user needed.
 */
const dataErrors = {
  NOT_FOUND: { status: 404 as const, message: "Database not found" as const },
  UNSUPPORTED: {
    status: 422 as const,
    message: "This engine has no relational workbench" as const,
    data: z.object({ engine: z.string() }),
  },
  UNREACHABLE: {
    status: 503 as const,
    message: "Could not reach the database" as const,
    data: z.object({ reason: z.string() }),
  },
  QUERY_FAILED: {
    status: 422 as const,
    message: "Query failed" as const,
    data: z.object({ reason: z.string() }),
  },
  NOT_EDITABLE: {
    status: 422 as const,
    message: "This row cannot be edited safely" as const,
    data: z.object({ reason: z.string() }),
  },
  DENIED: {
    status: 403 as const,
    message: "This connection is read-only" as const,
    data: z.object({ reason: z.string() }),
  },
};

const connectionIdField = zId(ID_PREFIX.dataConnection);

/**
 * WHICH database a call is about.
 *
 * A discriminated union rather than two optional ids, because the two are
 * resolved completely differently — a managed resource's credentials come from
 * `database_resource`, an external connection's from an encrypted URL — and a
 * request naming both is a request with no answer. Making that unrepresentable
 * is better than rejecting it in a refinement, and far better than resolving
 * whichever branch the handler happened to check first.
 */
const dataTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resource"), resourceId: resourceIdField }),
  z.object({ kind: z.literal("connection"), connectionId: connectionIdField }),
]);
export type DataTargetRef = z.infer<typeof dataTargetSchema>;

/** Build an input that names a target plus this procedure's own fields. */
function withTarget<T extends z.ZodRawShape>(shape: T) {
  return z.object({ target: dataTargetSchema, ...shape });
}

/** Fields a connection row exposes. NEVER the URL. */
const connectionSchema = z.object({
  id: connectionIdField,
  name: z.string(),
  engine: z.enum(["postgres", "mariadb"]),
  /** Host and database only: enough to identify it, no credential. */
  displayHost: z.string(),
  displayDatabase: z.string(),
  visibility: z.enum(["org", "private"]),
  environment: z.enum(["production", "other"]),
  defaultAccess: z.enum(["read-only", "read-write"]),
  requireTls: z.boolean(),
  createdAt: z.date(),
  lastConnectedAt: z.date().nullable(),
});

const schemaResultSchema = z.object({
  dialect: z.enum(["postgres", "mysql"]),
  defaultSchema: z.string(),
  /** True when the workbench may offer inline editing at all. */
  canWrite: z.boolean(),
  tables: z.array(
    z.object({
      schema: z.string(),
      name: z.string(),
      kind: z.enum(["table", "view", "materialized_view", "foreign_table"]),
      estimatedRows: z.number().nullable(),
      sizeBytes: z.number().nullable(),
      comment: z.string().nullable(),
      columns: z.array(columnSchema),
      /** False when the table has no primary key, so no row can be targeted. */
      canEdit: z.boolean(),
    }),
  ),
});

export const dataContract = {
  /**
   * The whole navigator in one call: tables, and every column of every table.
   *
   * Deliberately not paginated and not per-table. The predecessor fetched
   * columns lazily when a table was opened, which put a round trip in front of
   * every click; one query for the schema is cheaper than fifty for the tables
   * someone actually browses.
   */
  schema: oc
    .route({ method: "GET", path: `${basePath}/schema`, tags: [tag] })
    .input(withTarget({}))
    .output(schemaResultSchema)
    .errors(dataErrors),

  /**
   * Browse one table: filters, sorts and paging compiled server-side.
   *
   * The client sends a filter MODEL, never SQL. Operands are bound as
   * parameters and column names are checked against the table's real columns,
   * so neither can carry syntax into the statement.
   */
  browse: oc
    .route({ method: "POST", path: `${basePath}/browse`, tags: [tag] })
    .input(
      withTarget({
        schema: z.string().max(255).default(""),
        table: z.string().min(1).max(255),
        columns: z.array(z.string().max(255)).max(512).default([]),
        filters: z.array(filterSchema).max(64).default([]),
        sorts: z.array(sortSchema).max(16).default([]),
        limit: z.number().int().positive().max(1000).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .output(gridSchema)
    .errors(dataErrors),

  /** Exact row count for the same filtered set the grid is showing. */
  count: oc
    .route({ method: "POST", path: `${basePath}/count`, tags: [tag] })
    .input(
      withTarget({
        schema: z.string().max(255).default(""),
        table: z.string().min(1).max(255),
        filters: z.array(filterSchema).max(64).default([]),
      }),
    )
    .output(z.object({ total: z.number().int() }))
    .errors(dataErrors),

  /**
   * Run one arbitrary statement from the SQL runner.
   *
   * Read-only is enforced by the SESSION (a connect-time server setting), not
   * by inspecting this string. The statement classifier in the editor decides
   * which confirmation to show and has no authority here.
   */
  run: oc
    .route({ method: "POST", path: `${basePath}/run`, tags: [tag] })
    .input(
      withTarget({
        sql: z.string().min(1).max(100_000),
        limit: z.number().int().positive().max(1000).default(200),
        /** Opt in to a read-write session. Requires the `database:write` scope. */
        write: z.boolean().default(false),
      }),
    )
    .output(gridSchema)
    .errors(dataErrors),

  /**
   * Everything the Definitions view shows: indexes, constraints and enums.
   *
   * A separate call from `schema` rather than more fields on it, because the
   * navigator needs the schema on open and needs it fast — and nobody browsing
   * rows is waiting on an index list. Still ONE call for all three, and still
   * whole-database rather than per-table, so expanding a section costs nothing.
   */
  definitions: oc
    .route({ method: "GET", path: `${basePath}/definitions`, tags: [tag] })
    .input(withTarget({}))
    .output(
      z.object({
        indexes: z.array(
          z.object({
            schema: z.string(),
            table: z.string(),
            name: z.string(),
            columns: z.array(z.string()),
            isUnique: z.boolean(),
            isPrimary: z.boolean(),
            definition: z.string().nullable(),
            sizeBytes: z.number().nullable(),
          }),
        ),
        constraints: z.array(
          z.object({
            schema: z.string(),
            table: z.string(),
            name: z.string(),
            type: z.enum(["primary_key", "foreign_key", "unique", "check", "exclusion"]),
            columns: z.array(z.string()),
            definition: z.string().nullable(),
            referencedTable: z.object({ schema: z.string(), name: z.string() }).nullable(),
          }),
        ),
        enums: z.array(
          z.object({ schema: z.string(), name: z.string(), values: z.array(z.string()) }),
        ),
      }),
    )
    .errors(dataErrors),

  /** External connections this viewer may use. */
  listConnections: oc
    .route({ method: "GET", path: `${basePath}/connections`, tags: [tag] })
    .input(z.object({}))
    .output(z.object({ connections: z.array(connectionSchema) }))
    .errors(dataErrors),

  /**
   * Save an external database URL.
   *
   * The URL is validated, then encrypted, and is never returned by any
   * procedure afterwards. Loopback, private and cloud-metadata addresses are
   * refused: the control plane can reach things at those addresses that are not
   * the caller's to browse.
   */
  createConnection: oc
    .route({ method: "POST", path: `${basePath}/connections`, tags: [tag] })
    .input(
      z.object({
        name: z.string().min(1).max(120),
        url: z.string().min(1).max(4096),
        visibility: z.enum(["org", "private"]).default("org"),
        environment: z.enum(["production", "other"]).default("other"),
        defaultAccess: z.enum(["read-only", "read-write"]).default("read-only"),
        requireTls: z.boolean().default(true),
      }),
    )
    .output(connectionSchema)
    .errors({
      ...dataErrors,
      INVALID_URL: {
        status: 422 as const,
        message: "That connection URL cannot be used" as const,
        data: z.object({ reason: z.string() }),
      },
    }),

  /** Change a connection's settings. Omit `url` to leave the credential alone. */
  updateConnection: oc
    .route({ method: "PATCH", path: `${basePath}/connections/{id}`, tags: [tag] })
    .input(
      z.object({
        id: connectionIdField,
        name: z.string().min(1).max(120).optional(),
        url: z.string().min(1).max(4096).optional(),
        visibility: z.enum(["org", "private"]).optional(),
        environment: z.enum(["production", "other"]).optional(),
        defaultAccess: z.enum(["read-only", "read-write"]).optional(),
        requireTls: z.boolean().optional(),
      }),
    )
    .output(connectionSchema)
    .errors({
      ...dataErrors,
      INVALID_URL: {
        status: 422 as const,
        message: "That connection URL cannot be used" as const,
        data: z.object({ reason: z.string() }),
      },
    }),

  deleteConnection: oc
    .route({ method: "DELETE", path: `${basePath}/connections/{id}`, tags: [tag] })
    .input(z.object({ id: connectionIdField }))
    .output(z.object({ deleted: z.boolean() }))
    .errors(dataErrors),

  /** Open the connection once and report whether it worked. */
  testConnection: oc
    .route({ method: "POST", path: `${basePath}/connections/{id}/test`, tags: [tag] })
    .input(z.object({ id: connectionIdField }))
    .output(z.object({ ok: z.boolean(), durationMs: z.number(), serverVersion: z.string() }))
    .errors(dataErrors),

  /**
   * Apply staged row edits as ONE transaction.
   *
   * A list rather than a single mutation because that is what the grid actually
   * produces: N cell edits across M rows, which must land together or not at
   * all. Firing them one at a time can leave a row half-updated when the third
   * violates a constraint — exactly the failure a staged-edit bar promises
   * cannot happen.
   *
   * Every statement is BUILT HERE from the structured request against the
   * table's introspected columns. The client never sends SQL for a write.
   */
  mutate: oc
    .route({ method: "POST", path: `${basePath}/mutate`, tags: [tag] })
    .input(
      withTarget({
        mutations: z.array(mutationSchema).min(1).max(500),
      }),
    )
    .output(
      z.object({
        /** Rows affected across the whole transaction. */
        rowsAffected: z.number().int(),
        durationMs: z.number(),
      }),
    )
    .errors(dataErrors),
};
