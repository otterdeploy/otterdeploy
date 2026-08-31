/**
 * Turning a dialect's introspection SQL into the neutral shapes the UI reads.
 *
 * Each dialect's query is written to produce the SAME column names, so the
 * parsing below is dialect-independent and every engine gets one navigator, one
 * column header and one editor. Rows are parsed with zod rather than trusted:
 * this is a JSON-ish boundary in everything but name, and the repo bans
 * `row as Shape`.
 */
import type { ColumnMeta, TableMeta } from "@otterdeploy/data-engine";

import { Result } from "better-result";
import * as z from "zod";

import type { Connection } from "./pool";

import { DataError, toDataError } from "./errors";

/**
 * Coerce the many ways an engine reports a count or a size into a number, or
 * null.
 *
 * MySQL returns strings, ClickHouse returns bigints, Postgres returns whichever
 * the driver felt like for an int8. Anything that does not become a finite
 * non-negative number is null, meaning "unknown" -- which is different from
 * zero and must not be flattened into it.
 */
const numericish = z
  .union([z.number(), z.bigint(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });

/** Engines report booleans as true/false, as 1/0, or as "YES"/"NO". */
const boolish = z
  .union([z.boolean(), z.number(), z.bigint(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number" || typeof v === "bigint") return Number(v) !== 0;
    if (typeof v === "string") return ["1", "true", "t", "yes"].includes(v.toLowerCase());
    return false;
  });

function isScalar(value: unknown): value is string | number | bigint {
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint";
}

const stringish = z
  .union([z.string(), z.number(), z.bigint(), z.null(), z.undefined()])
  .transform((v) => (v === null || v === undefined ? null : String(v)));

/** Engines return array columns as arrays, or as a comma-joined string. */
const listish = z
  .union([z.array(z.unknown()), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    // Enum labels and column names. Anything that is not already a scalar is
    // dropped rather than stringified into "[object Object]".
    if (Array.isArray(v)) return v.flatMap((x) => (isScalar(x) ? [String(x)] : []));
    if (typeof v === "string" && v !== "") return v.split(",");
    return [];
  });

const tableRowSchema = z.object({
  schema: stringish,
  name: stringish,
  kind: z.string().default("table"),
  estimated_rows: numericish,
  size_bytes: numericish,
  comment: stringish,
});

const TABLE_KINDS = ["table", "view", "materialized_view", "foreign_table"] as const;
type TableKind = (typeof TABLE_KINDS)[number];

function isTableKind(value: string): value is TableKind {
  return TABLE_KINDS.some((kind) => kind === value);
}

const columnRowSchema = z.object({
  schema: stringish,
  table_name: stringish,
  name: stringish,
  data_type: stringish,
  nullable: boolish,
  position: numericish,
  default_expr: stringish,
  is_primary_key: boolish,
  is_unique: boolish,
  is_generated: boolish,
  ref_schema: stringish,
  ref_table: stringish,
  ref_column: stringish,
  enum_values: listish.optional(),
  comment: stringish,
});

/** Run one dialect introspection query and parse its rows. */
async function introspectRows<T>(
  connection: Connection,
  sql: string,
  schema: z.ZodType<T>,
): Promise<Result<T[], DataError>> {
  const ran = await Result.tryPromise({
    try: async (): Promise<unknown> => connection.sql.unsafe(sql),
    catch: toDataError,
  });
  if (ran.isErr()) return Result.err(ran.error);

  const rows = Array.isArray(ran.value) ? ran.value : [];
  const parsed = z.array(schema).safeParse(rows);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Result.err(
      new DataError(
        "query",
        `introspection returned an unexpected shape: ${first?.message ?? "unknown"}`,
      ),
    );
  }
  return Result.ok(parsed.data);
}

export async function listTables(connection: Connection): Promise<Result<TableMeta[], DataError>> {
  const rows = await introspectRows(
    connection,
    connection.dialect.introspection.tables,
    tableRowSchema,
  );
  if (rows.isErr()) return Result.err(rows.error);
  return Result.ok(
    rows.value.map((r) => ({
      schema: r.schema ?? "",
      name: r.name ?? "",
      kind: isTableKind(r.kind) ? r.kind : "table",
      estimatedRows: r.estimated_rows,
      sizeBytes: r.size_bytes,
      comment: r.comment,
    })),
  );
}

export interface TableColumns {
  schema: string;
  table: string;
  columns: ColumnMeta[];
}

/**
 * Every column in the database, grouped by table, in ONE round trip.
 *
 * A database with 200 tables would otherwise open the navigator with 200
 * queries. The viewer this replaces fetched columns per table on demand, which
 * is most of why opening a table felt slow.
 */
export async function listColumns(
  connection: Connection,
): Promise<Result<TableColumns[], DataError>> {
  const rows = await introspectRows(
    connection,
    connection.dialect.introspection.columns,
    columnRowSchema,
  );
  if (rows.isErr()) return Result.err(rows.error);

  const grouped = new Map<string, TableColumns>();
  for (const r of rows.value) {
    const schema = r.schema ?? "";
    const table = r.table_name ?? "";
    const key = `${schema} ${table}`;
    const bucket = grouped.get(key) ?? { schema, table, columns: [] };
    const dataType = r.data_type ?? "";
    bucket.columns.push({
      name: r.name ?? "",
      dataType,
      kind: connection.dialect.classifyType(dataType),
      nullable: r.nullable,
      position: r.position ?? bucket.columns.length + 1,
      defaultExpr: r.default_expr,
      isPrimaryKey: r.is_primary_key,
      isUnique: r.is_unique,
      isGenerated: r.is_generated,
      references:
        r.ref_table === null
          ? null
          : { schema: r.ref_schema ?? "", name: r.ref_table, column: r.ref_column ?? "" },
      enumValues: r.enum_values && r.enum_values.length > 0 ? r.enum_values : null,
      comment: r.comment,
    });
    grouped.set(key, bucket);
  }
  return Result.ok([...grouped.values()]);
}
