/**
 * Introspecting the schema objects that are NOT tables: indexes, constraints
 * and enums.
 *
 * Split from `introspect.ts` because they answer a different question. Tables
 * and columns are what the navigator needs to open at all; these are what you
 * go looking for when a query is slow or a write is refused, and they are read
 * on demand rather than on connect.
 */
import type { ConstraintMeta, IndexMeta } from "@otterdeploy/data-engine";

import { Result } from "better-result";
import * as z from "zod";

import type { Connection } from "./pool";

import { DataError } from "./errors";
import { introspectRows } from "./introspect";
import { boolish, listish, numericish, stringish } from "./introspect-coerce";

const indexRowSchema = z.object({
  schema: stringish,
  table_name: stringish,
  name: stringish,
  is_unique: boolish,
  is_primary: boolish,
  definition: stringish,
  size_bytes: numericish,
  columns: listish,
});

const constraintRowSchema = z.object({
  schema: stringish,
  table_name: stringish,
  name: stringish,
  type: z.string().default("check"),
  definition: stringish,
  ref_schema: stringish,
  ref_table: stringish,
  columns: listish,
});

const CONSTRAINT_TYPES = ["primary_key", "foreign_key", "unique", "check", "exclusion"] as const;
type ConstraintType = (typeof CONSTRAINT_TYPES)[number];

function isConstraintType(value: string): value is ConstraintType {
  return CONSTRAINT_TYPES.some((t) => t === value);
}

export interface TableIndexes {
  schema: string;
  table: string;
  indexes: IndexMeta[];
}

/**
 * Every index in the database, grouped by table.
 *
 * One round trip for the same reason the column list is: a Definitions tab that
 * fetched per table would put a query in front of every expansion.
 */
export async function listIndexes(
  connection: Connection,
): Promise<Result<TableIndexes[], DataError>> {
  const rows = await introspectRows(
    connection,
    connection.dialect.introspection.indexes,
    indexRowSchema,
  );
  if (rows.isErr()) return Result.err(rows.error);

  const grouped = new Map<string, TableIndexes>();
  for (const r of rows.value) {
    const schema = r.schema ?? "";
    const table = r.table_name ?? "";
    const key = `${schema} ${table}`;
    const bucket = grouped.get(key) ?? { schema, table, indexes: [] };
    bucket.indexes.push({
      name: r.name ?? "",
      columns: r.columns,
      isUnique: r.is_unique,
      isPrimary: r.is_primary,
      definition: r.definition,
      sizeBytes: r.size_bytes,
    });
    grouped.set(key, bucket);
  }
  return Result.ok([...grouped.values()]);
}

export interface TableConstraints {
  schema: string;
  table: string;
  constraints: ConstraintMeta[];
}

export async function listConstraints(
  connection: Connection,
): Promise<Result<TableConstraints[], DataError>> {
  const rows = await introspectRows(
    connection,
    connection.dialect.introspection.constraints,
    constraintRowSchema,
  );
  if (rows.isErr()) return Result.err(rows.error);

  const grouped = new Map<string, TableConstraints>();
  for (const r of rows.value) {
    const schema = r.schema ?? "";
    const table = r.table_name ?? "";
    const key = `${schema} ${table}`;
    const bucket = grouped.get(key) ?? { schema, table, constraints: [] };
    bucket.constraints.push({
      name: r.name ?? "",
      // An unrecognised type becomes `check` rather than being dropped: the
      // constraint exists and the user should see it, even if we mislabel it.
      type: isConstraintType(r.type) ? r.type : "check",
      columns: r.columns,
      definition: r.definition,
      referencedTable:
        r.ref_table === null ? null : { schema: r.ref_schema ?? "", name: r.ref_table },
    });
    grouped.set(key, bucket);
  }
  return Result.ok([...grouped.values()]);
}

const enumRowSchema = z.object({
  schema: stringish,
  name: stringish,
  values: listish,
});

export interface EnumType {
  schema: string;
  name: string;
  values: string[];
}

/**
 * Enum types, or an empty list where the engine has no enum catalog.
 *
 * MySQL's enums are an inline column type rather than a catalog object, so
 * `introspection.enums` is null there and this returns nothing — which is
 * accurate, not a failure.
 */
export async function listEnums(connection: Connection): Promise<Result<EnumType[], DataError>> {
  const sql = connection.dialect.introspection.enums;
  if (sql === null) return Result.ok([]);
  const rows = await introspectRows(connection, sql, enumRowSchema);
  if (rows.isErr()) return Result.err(rows.error);
  return Result.ok(
    rows.value.map((r) => ({ schema: r.schema ?? "", name: r.name ?? "", values: r.values })),
  );
}
