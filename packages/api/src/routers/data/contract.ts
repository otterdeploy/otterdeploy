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
import { cellValueSchema, columnSchema, filterSchema, sortSchema } from "@otterdeploy/data-engine";
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
  DENIED: {
    status: 403 as const,
    message: "This connection is read-only" as const,
    data: z.object({ reason: z.string() }),
  },
};

/** A page of typed rows. Mirrors `Grid` in @otterdeploy/data-engine. */
const gridResultSchema = z.object({
  columns: z.array(columnSchema),
  rows: z.array(z.array(cellValueSchema)),
  rowCount: z.number().int(),
  truncated: z.boolean(),
  rowsAffected: z.number().int().nullable(),
  durationMs: z.number(),
  notices: z.array(z.string()),
});

const connectionRefSchema = z.object({
  /** v1 targets managed resources only. External connections land next. */
  resourceId: resourceIdField,
});

const schemaResultSchema = z.object({
  dialect: z.enum(["postgres", "mysql", "clickhouse"]),
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
    .input(connectionRefSchema)
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
      connectionRefSchema.extend({
        schema: z.string().max(255).default(""),
        table: z.string().min(1).max(255),
        columns: z.array(z.string().max(255)).max(512).default([]),
        filters: z.array(filterSchema).max(64).default([]),
        sorts: z.array(sortSchema).max(16).default([]),
        limit: z.number().int().positive().max(1000).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .output(gridResultSchema)
    .errors(dataErrors),

  /** Exact row count for the same filtered set the grid is showing. */
  count: oc
    .route({ method: "POST", path: `${basePath}/count`, tags: [tag] })
    .input(
      connectionRefSchema.extend({
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
      connectionRefSchema.extend({
        sql: z.string().min(1).max(100_000),
        limit: z.number().int().positive().max(1000).default(200),
        /** Opt in to a read-write session. Requires the `database:write` scope. */
        write: z.boolean().default(false),
      }),
    )
    .output(gridResultSchema)
    .errors(dataErrors),
};
