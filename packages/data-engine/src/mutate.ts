/**
 * Row mutations, built server-side from a structured request.
 *
 * The client never sends a statement. It sends "this table, this primary key,
 * these column assignments", and the SQL is assembled here from the table's own
 * introspected columns. Two consequences worth stating:
 *
 *   - A column name that is not in the table is rejected, not quoted-and-hoped.
 *     Identifiers cannot be parameterized, so validating against the real
 *     column list is the only thing standing between a quoting bug and DDL.
 *   - A table with no primary key refuses UPDATE and DELETE entirely. Postgres
 *     `ctid` would let us target a row, but a physical row pointer is invalidated
 *     by any concurrent write, so "it worked in testing" would become "it edited
 *     someone else's row in production".
 */
import type { SQL } from "drizzle-orm";

import { Result, TaggedError } from "better-result";
import { sql } from "drizzle-orm";
import * as z from "zod";

import type { Dialect } from "./dialect";
import type { ColumnMeta, PreparedStatement } from "./types";
import type { CellValue } from "./value";

import { compile, qualified } from "./filters";
import { cellValueSchema, toDriverParam } from "./value";

export const columnAssignmentSchema = z.object({
  column: z.string().min(1).max(255),
  value: cellValueSchema,
});
export type ColumnAssignment = z.infer<typeof columnAssignmentSchema>;

export const MUTATION_OPS = ["insert", "update", "delete"] as const;
export type MutationOp = (typeof MUTATION_OPS)[number];

export const mutationSchema = z.object({
  op: z.enum(MUTATION_OPS),
  schema: z.string().max(255).default(""),
  table: z.string().min(1).max(255),
  /** Every primary-key column, so exactly one row matches. Empty for insert. */
  pk: z.array(columnAssignmentSchema).max(32).default([]),
  /** Column assignments. Empty for delete. */
  set: z.array(columnAssignmentSchema).max(512).default([]),
});
export type Mutation = z.infer<typeof mutationSchema>;

export class MutationError extends TaggedError("MutationError")<{
  reason:
    | "no_primary_key"
    | "unknown_column"
    | "incomplete_key"
    | "empty_assignment"
    | "generated_column";
  message: string;
}>() {
  constructor(
    reason:
      | "no_primary_key"
      | "unknown_column"
      | "incomplete_key"
      | "empty_assignment"
      | "generated_column",
    message: string,
  ) {
    super({ reason, message });
  }
}

interface BuildContext {
  dialect: Dialect;
  /** The table's real columns, as introspected. The allowlist for identifiers. */
  columns: readonly ColumnMeta[];
}

/** Validate that every referenced column exists, and return their metadata. */
function resolve(
  assignments: readonly ColumnAssignment[],
  columns: readonly ColumnMeta[],
): Result<Array<{ meta: ColumnMeta; value: CellValue }>, MutationError> {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const out: Array<{ meta: ColumnMeta; value: CellValue }> = [];
  for (const a of assignments) {
    const meta = byName.get(a.column);
    if (!meta) {
      return Result.err(
        new MutationError("unknown_column", `column "${a.column}" does not exist on this table`),
      );
    }
    out.push({ meta, value: a.value });
  }
  return Result.ok(out);
}

/**
 * The WHERE that targets exactly one row.
 *
 * Requires the FULL primary key: a partial key would silently widen an UPDATE
 * from one row to a whole partition of the table.
 *
 * A NULL in a key column is rejected rather than compiled to `IS NULL`, because
 * a nullable primary-key column cannot exist — so a null here means the client
 * sent a key it had not actually loaded, and matching on it would be a guess.
 */
function primaryKeyWhere(
  pk: ReadonlyArray<{ meta: ColumnMeta; value: CellValue }>,
  ctx: BuildContext,
): Result<SQL, MutationError> {
  const keyColumns = ctx.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  if (keyColumns.length === 0) {
    return Result.err(
      new MutationError(
        "no_primary_key",
        "this table has no primary key, so a single row cannot be targeted safely",
      ),
    );
  }
  const provided = new Set(pk.map((p) => p.meta.name));
  const missing = keyColumns.filter((c) => !provided.has(c));
  if (missing.length > 0) {
    return Result.err(
      new MutationError("incomplete_key", `primary key is missing ${missing.join(", ")}`),
    );
  }
  const parts: SQL[] = [];
  for (const { meta, value } of pk) {
    if (!meta.isPrimaryKey) continue;
    if (value === null) {
      return Result.err(
        new MutationError("incomplete_key", `primary key column "${meta.name}" cannot be null`),
      );
    }
    parts.push(sql`${sql.identifier(meta.name)} = ${toDriverParam(value)}`);
  }
  return Result.ok(sql.join(parts, sql` AND `));
}

/**
 * Build the statement for one row mutation.
 *
 * Postgres and MySQL differ on returning the changed row: Postgres has
 * `RETURNING *`, MySQL has nothing, so the caller re-reads on that dialect.
 * `returnsRows` says which happened rather than making the caller guess.
 */
export function buildMutation(
  mutation: Mutation,
  ctx: BuildContext,
): Result<PreparedStatement & { returnsRows: boolean }, MutationError> {
  const target = qualified(ctx.dialect, mutation.schema, mutation.table);
  // Postgres can hand back the row it just changed; MySQL cannot, so the caller
  // re-reads there. `returnsRows` says which happened rather than making the
  // caller infer it from the dialect.
  const supportsReturning = ctx.dialect.id === "postgres";
  const returning = supportsReturning ? sql` RETURNING *` : sql``;

  const built = buildStatement(mutation, ctx, target, returning);
  if (built.isErr()) return Result.err(built.error);
  return Result.ok({ ...compile(ctx.dialect, built.value), returnsRows: supportsReturning });
}

function buildStatement(
  mutation: Mutation,
  ctx: BuildContext,
  target: SQL,
  returning: SQL,
): Result<SQL, MutationError> {
  if (mutation.op === "delete") return buildDelete(mutation, ctx, target, returning);

  const set = resolve(mutation.set, ctx.columns);
  if (set.isErr()) return Result.err(set.error);
  if (set.value.length === 0) {
    return Result.err(new MutationError("empty_assignment", "no columns to write"));
  }
  // Writing a generated/identity column is rejected rather than silently
  // dropped: the caller believes it set a value, and the row would come back
  // different from what the grid shows.
  const generated = set.value.find((s) => s.meta.isGenerated);
  if (generated) {
    return Result.err(
      new MutationError(
        "generated_column",
        `"${generated.meta.name}" is generated by the database and cannot be written`,
      ),
    );
  }

  if (mutation.op === "insert") {
    const cols = sql.join(
      set.value.map((s) => sql`${sql.identifier(s.meta.name)}`),
      sql`, `,
    );
    const vals = sql.join(
      set.value.map((s) => sql`${toDriverParam(s.value)}`),
      sql`, `,
    );
    return Result.ok(sql`INSERT INTO ${target} (${cols}) VALUES (${vals})${returning}`);
  }

  const assignments = sql.join(
    set.value.map((s) => sql`${sql.identifier(s.meta.name)} = ${toDriverParam(s.value)}`),
    sql`, `,
  );
  const pk = resolve(mutation.pk, ctx.columns);
  if (pk.isErr()) return Result.err(pk.error);
  const where = primaryKeyWhere(pk.value, ctx);
  if (where.isErr()) return Result.err(where.error);
  return Result.ok(sql`UPDATE ${target} SET ${assignments} WHERE ${where.value}${returning}`);
}

function buildDelete(
  mutation: Mutation,
  ctx: BuildContext,
  target: SQL,
  returning: SQL,
): Result<SQL, MutationError> {
  const pk = resolve(mutation.pk, ctx.columns);
  if (pk.isErr()) return Result.err(pk.error);
  const where = primaryKeyWhere(pk.value, ctx);
  if (where.isErr()) return Result.err(where.error);
  return Result.ok(sql`DELETE FROM ${target} WHERE ${where.value}${returning}`);
}

/** True when the workbench may offer inline editing for this table at all. */
export function isEditable(columns: readonly ColumnMeta[]): boolean {
  return columns.some((c) => c.isPrimaryKey);
}
