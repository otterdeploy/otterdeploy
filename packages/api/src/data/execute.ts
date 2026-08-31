/**
 * Running a statement and returning a typed {@link Grid}.
 *
 * What changed versus the path this replaces: the statement is parameterized,
 * the rows come back as JavaScript values rather than CSV text, and the column
 * families are either the introspected truth (table browsing) or an honest
 * inference (the SQL runner). Nothing here re-parses a string the server
 * already had structured.
 */
import type { CellKind, ColumnMeta, Grid, PreparedStatement } from "@otterdeploy/data-engine";

import { Result } from "better-result";

import type { DataError } from "./errors";
import type { Connection } from "./pool";

import { decodeRow } from "./decode";
import { dataError, toDataError } from "./errors";
import { awaitQuery, runOnConnection } from "./pool";

/** Hard ceiling on rows returned to a browser, whatever the caller asked for. */
const MAX_ROWS = 5_000;

export interface ExecuteOptions {
  /**
   * The statement was compiled by this codebase (bound params, validated
   * columns), not authored by a user — skip the READ ONLY transaction fence
   * and its two extra round trips. Never set for `data.run` input.
   */
  trustedRead?: boolean;
  /**
   * Families for the result columns, positionally.
   *
   * Supplied when browsing a table (introspection knows the real types).
   * Omitted for arbitrary SQL, where each value's family is inferred from what
   * the driver produced — less precise, and deliberately not guessed harder.
   */
  kinds?: readonly CellKind[];
  /** Column metadata to attach to the grid, when the caller has it. */
  columns?: readonly ColumnMeta[];
  /** Stop after this many rows. One extra is fetched to detect truncation. */
  limit?: number;
}

/** A column we only know the name of — the SQL runner's case. */
function inferredColumn(name: string, position: number): ColumnMeta {
  return {
    name,
    // Honest: the driver told us the name and nothing else. Rendering a guessed
    // type in the header would be a claim the database never made.
    dataType: "",
    kind: "opaque",
    nullable: true,
    position,
    defaultExpr: null,
    isPrimaryKey: false,
    isUnique: false,
    isGenerated: false,
    references: null,
    enumValues: null,
    comment: null,
  };
}

/**
 * Execute one prepared statement.
 *
 * `.values()` asks the driver for array rows rather than objects, which keeps
 * duplicate column names distinct — `SELECT a.id, b.id FROM …` collapses to one
 * key in object mode, and a grid that silently drops a column is worse than one
 * that shows two called `id`.
 */
export async function execute(
  connection: Connection,
  statement: PreparedStatement,
  options: ExecuteOptions = {},
): Promise<Result<Grid, DataError>> {
  const limit = Math.min(options.limit ?? MAX_ROWS, MAX_ROWS);
  const startedAt = performance.now();

  const ran = await Result.tryPromise({
    try: async () => {
      return runOnConnection(
        connection,
        async (sql) => {
          const query = sql.unsafe(statement.sql, [...statement.params]);
          const rows: unknown = await awaitQuery(query.values());
          return {
            rows,
            columns: readColumnNames(query),
            rowsAffected: readRowsAffected(query),
          };
        },
        { trustedRead: options.trustedRead },
      );
    },
    catch: toDataError,
  });
  if (ran.isErr()) return Result.err(ran.error);

  const durationMs = Math.round(performance.now() - startedAt);
  const rawRows = Array.isArray(ran.value.rows) ? ran.value.rows : [];
  const truncated = rawRows.length > limit;
  const kept = truncated ? rawRows.slice(0, limit) : rawRows;

  const declared = options.columns;
  const kinds = options.kinds ?? declared?.map((c) => c.kind) ?? [];
  const columns =
    declared !== undefined
      ? [...declared]
      : ran.value.columns.map((name, i) => inferredColumn(name, i + 1));

  return Result.ok({
    columns,
    rows: kept.map((row) => decodeRow(Array.isArray(row) ? row : [row], kinds)),
    rowCount: kept.length,
    truncated,
    // Bun's driver does not surface an affected-row count separately from the
    // returned rows; for RETURNING statements the row count is the answer, and
    // null is honest for the rest rather than a fabricated zero.
    rowsAffected: ran.value.rowsAffected,
    durationMs,
    notices: [],
  });
}

/**
 * Column names off a driver result, without asserting its shape.
 *
 * Bun exposes `columns` on the query object; when it is absent (older runtime,
 * a statement that returns nothing) the grid falls back to positional headers
 * rather than failing the request.
 */
function readColumnNames(query: unknown): string[] {
  if (typeof query !== "object" || query === null || !("columns" in query)) return [];
  const { columns } = query;
  if (!Array.isArray(columns)) return [];
  return columns.map((c) => (typeof c === "string" ? c : String(c)));
}

function readRowsAffected(query: unknown): number | null {
  if (typeof query !== "object" || query === null) return null;
  for (const property of ["affectedRows", "rowCount", "count"] as const) {
    if (!(property in query)) continue;
    const value = Reflect.get(query, property);
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

/**
 * Run several statements as ONE transaction.
 *
 * This is what a staged-edit commit uses: N cell edits become N statements that
 * either all land or none do. The alternative — firing them one at a time — can
 * leave a row half-updated when the third one violates a constraint, which is
 * exactly the failure the drafts UI promises cannot happen.
 */
export async function executeTransaction(
  connection: Connection,
  statements: readonly PreparedStatement[],
  options: ExecuteOptions = {},
): Promise<Result<Grid[], DataError>> {
  if (connection.target.mode === "read-only") {
    return Result.err(dataError("denied", "this connection is read-only"));
  }
  if (!connection.dialect.supportsTransactions) {
    return Result.err(
      dataError(
        "unsupported",
        `${connection.target.engine} has no interactive transaction, so a staged commit cannot be atomic`,
      ),
    );
  }

  return Result.tryPromise({
    try: () =>
      connection.sql.begin(async (tx) => {
        const grids: Grid[] = [];
        for (const statement of statements) {
          const startedAt = performance.now();
          const query = tx.unsafe(statement.sql, [...statement.params]);
          const rows: unknown = await awaitQuery(query.values());
          const rawRows = Array.isArray(rows) ? rows : [];
          const kinds = options.kinds ?? options.columns?.map((c) => c.kind) ?? [];
          const rowsAffected =
            readRowsAffected(query) ?? (rawRows.length > 0 ? rawRows.length : null);
          if (statement.expectsAffectedRow && rowsAffected === 0) {
            throw dataError(
              "query",
              "the row changed or was deleted after it was loaded; refresh before committing",
            );
          }
          grids.push({
            columns: options.columns ? [...options.columns] : [],
            rows: rawRows.map((row) => decodeRow(Array.isArray(row) ? row : [row], kinds)),
            rowCount: rawRows.length,
            truncated: false,
            rowsAffected,
            durationMs: Math.round(performance.now() - startedAt),
            notices: [],
          });
        }
        return grids;
      }),
    catch: toDataError,
  });
}
