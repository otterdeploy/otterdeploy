import * as z from "zod";

/**
 * Shapes the introspection layer produces and the UI consumes. Deliberately
 * dialect-neutral: a Postgres `pg_catalog` row, a MySQL `information_schema`
 * row and a ClickHouse `system.columns` row all normalise into the same
 * `ColumnMeta`, which is what lets one grid, one filter bar and one editor
 * serve every engine instead of the four forks we have today.
 */
import { cellKindSchema, cellValueSchema } from "./value";

/** Dialects that speak SQL well enough to share the relational workbench. */
export const DIALECT_IDS = ["postgres", "mysql", "clickhouse"] as const;
export type DialectId = (typeof DIALECT_IDS)[number];
export const dialectIdSchema = z.enum(DIALECT_IDS);

export const tableRefSchema = z.object({
  /** Empty string for dialects without schemas; never null, so keys are stable. */
  schema: z.string(),
  name: z.string(),
});
export type TableRef = z.infer<typeof tableRefSchema>;

/** Stable identity for a table across renders, URLs and store keys. */
export function tableKey(ref: TableRef): string {
  return ref.schema === "" ? ref.name : `${ref.schema}.${ref.name}`;
}

export const tableSchema = tableRefSchema.extend({
  kind: z.enum(["table", "view", "materialized_view", "foreign_table"]),
  /**
   * Planner estimate, never `count(*)` — the navigator must not turn opening a
   * database into a full scan of every table in it. `null` means the engine
   * has never analysed the table, which is honest and different from zero.
   */
  estimatedRows: z.number().nullable(),
  /** On-disk bytes including indexes, when the engine reports it cheaply. */
  sizeBytes: z.number().nullable(),
  comment: z.string().nullable(),
});
export type TableMeta = z.infer<typeof tableSchema>;

export const columnSchema = z.object({
  name: z.string(),
  /** The engine's own type name, shown verbatim in the column header. */
  dataType: z.string(),
  /** Which family the grid renders and the editor validates against. */
  kind: cellKindSchema,
  nullable: z.boolean(),
  /** Ordinal position, 1-based, as the engine reports it. */
  position: z.number().int(),
  defaultExpr: z.string().nullable(),
  isPrimaryKey: z.boolean(),
  /** Covered by a single-column UNIQUE constraint (a PK also counts). */
  isUnique: z.boolean(),
  /** Set when the engine fills the column itself (serial, identity, generated). */
  isGenerated: z.boolean(),
  /** Target of a single-column foreign key, for the cell's "peek" affordance. */
  references: tableRefSchema.extend({ column: z.string() }).nullable(),
  /** Allowed values for an enum-typed column, so the editor offers a select. */
  enumValues: z.array(z.string()).nullable(),
  comment: z.string().nullable(),
});
export type ColumnMeta = z.infer<typeof columnSchema>;

export const indexSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  isUnique: z.boolean(),
  isPrimary: z.boolean(),
  /** The engine's own definition text, when it exposes one. */
  definition: z.string().nullable(),
  sizeBytes: z.number().nullable(),
});
export type IndexMeta = z.infer<typeof indexSchema>;

export const constraintSchema = z.object({
  name: z.string(),
  type: z.enum(["primary_key", "foreign_key", "unique", "check", "exclusion"]),
  columns: z.array(z.string()),
  definition: z.string().nullable(),
  referencedTable: tableRefSchema.nullable(),
});
export type ConstraintMeta = z.infer<typeof constraintSchema>;

/** A page of rows plus everything the footer needs to be honest about it. */
export const gridSchema = z.object({
  columns: z.array(columnSchema),
  rows: z.array(z.array(cellValueSchema)),
  /** Rows in THIS page. Not the table's total — that is a separate count. */
  rowCount: z.number().int(),
  /** True when the engine had more rows than `limit` and we stopped early. */
  truncated: z.boolean(),
  /** Rows the statement changed, for INSERT / UPDATE / DELETE. */
  rowsAffected: z.number().int().nullable(),
  durationMs: z.number(),
  /** Server-side notices (Postgres RAISE NOTICE, MySQL warnings). */
  notices: z.array(z.string()),
});
export type Grid = z.infer<typeof gridSchema>;

/**
 * A parameterized statement, compiled by the dialect's own Drizzle compiler.
 *
 * `params` are already driver-ready values, not `CellValue`s: the conversion
 * happens while the fragment is built, so a caller cannot forget it. Nothing in
 * this package ever returns SQL with a value spliced into it — the predecessor
 * escaped quotes and hoped, and "escaped correctly" is a property you cannot
 * test into existence.
 */
export interface PreparedStatement {
  sql: string;
  params: unknown[];
}

export const sortDirectionSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

export const sortSchema = z.object({
  column: z.string(),
  direction: sortDirectionSchema,
  /** Postgres and MySQL 8 both support explicit NULL placement. */
  nulls: z.enum(["first", "last"]).nullable().default(null),
});
export type Sort = z.infer<typeof sortSchema>;
