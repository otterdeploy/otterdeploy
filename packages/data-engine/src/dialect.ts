/**
 * The seam that removes the forks.
 *
 * Today Postgres has ~5,000 lines of viewer, MariaDB has a 237-line table
 * browser, Mongo has 234, Redis has 350, and every other engine gets a
 * "not supported" card. None of them share a grid, a value decoder or a SQL
 * builder, so each new engine costs another fork.
 *
 * A `Dialect` is the whole of what actually differs between SQL engines.
 * Everything above this interface — the grid, the filters, the drafts, the
 * tabs — is written once.
 *
 * **Quoting and parameter binding are NOT in this interface.** They belong to
 * Drizzle, which the repo already depends on everywhere: `PgDialect` and
 * `MySqlDialect` compile a `SQL` fragment to `{ sql, params }` without a
 * connection, and get identifier escaping (`"we""ird"` vs `` `we``ird` ``),
 * placeholder numbering (`$1` vs `?`) and IN-list expansion right per engine.
 * Those are precisely the details that are easy to hand-roll *almost*
 * correctly.
 *
 * What remains here is the engine-specific behaviour a query builder cannot
 * know: how to make a session read-only, how to spell a case-insensitive match,
 * how to place nulls in an ORDER BY, and which catalog to introspect.
 *
 * Non-relational engines (Redis, Mongo) deliberately have NO dialect. Pretending
 * a keyspace is a table is the mistake `UnsupportedDataViewer` was written to
 * avoid; they keep their own views inside the same shell instead.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { SQL } from "drizzle-orm";

import type { DialectId } from "./types";
import type { CellKind } from "./value";

/**
 * The compile-only surface of a Drizzle dialect.
 *
 * Structural rather than a union of `PgDialect | MySqlDialect`, so a dialect
 * can be added without widening a type here — and so nothing in this package
 * can accidentally reach for a method that would need a live connection.
 */
export interface SqlCompiler {
  sqlToQuery(query: SQL): { sql: string; params: unknown[] };
}

export interface IntrospectionSql {
  /** Schemas the user may browse, already excluding the engine's own catalogs. */
  schemas: string;
  /** Tables + views with a cheap row estimate and size. */
  tables: string;
  /** Columns for every table, one round trip. */
  columns: string;
  indexes: string;
  constraints: string;
  /** Enum catalog, or null when the engine has none as a first-class object. */
  enums: string | null;
}

export interface Dialect {
  readonly id: DialectId;
  /** Engines this dialect serves. MariaDB and MySQL share one wire protocol. */
  readonly engines: readonly DatabaseEngine[];
  /** False where the engine has no namespace above the table. */
  readonly supportsSchemas: boolean;
  /** False where the engine has no interactive multi-statement transaction. */
  readonly supportsTransactions: boolean;
  /** The schema a fresh connection browses first. */
  readonly defaultSchema: string;

  /**
   * The binary wire protocol this engine speaks, or null when it has none we
   * can drive.
   *
   * Genuinely dialect knowledge — MariaDB speaks MySQL's protocol, ClickHouse
   * speaks its own over HTTP — and the fact that decides whether the workbench
   * can serve an engine at all. Kept here rather than as a list in the pool so
   * "has a dialect" and "can actually be connected to" cannot drift apart, and
   * so the UI can say "not yet" up front instead of after a failed connect.
   */
  readonly wireProtocol: "postgres" | "mysql" | null;

  /**
   * The compile-only Drizzle dialect. Memoised by the dialect module: building
   * one per statement would allocate a compiler per keystroke.
   */
  compiler(): SqlCompiler;

  /** Cast an expression to text, so LIKE works on non-text columns. */
  castToText(expr: SQL): SQL;

  /**
   * Case-insensitive containment. Postgres needs `ILIKE`; MySQL's default
   * collations are already insensitive, so a plain `LIKE` is correct there and
   * `ILIKE` would be a syntax error.
   */
  caseInsensitiveLike(expr: SQL, pattern: SQL, negate: boolean): SQL;

  /**
   * One `ORDER BY` term, including null placement.
   *
   * Engine-specific because the emulation differs: native `NULLS LAST` needs
   * MySQL 8.0.31+, and the portable `ISNULL(x)` prefix works on every version.
   */
  orderByTerm(column: SQL, direction: "asc" | "desc", nulls: "first" | "last" | null): SQL;

  /**
   * Connection-time parameters that make the session refuse writes, or null
   * when the engine has no such parameter.
   *
   * This is the strongest form of the guarantee available to us: the setting is
   * applied by the SERVER when the connection is established, so it holds for
   * every statement on every connection the pool opens — including connections
   * opened later to meet demand. A statement issued after connect would only
   * cover the connections we remembered to issue it on.
   *
   * Null does NOT mean "allow writes". It means this engine cannot be made
   * read-only at connect time, so the caller must connect as a read-only ROLE
   * instead. A lexical statement classifier is a UX hint and must never be
   * promoted into the security boundary — a CTE or a stored procedure defeats it.
   */
  readOnlyConnectionParams(): Record<string, string> | null;

  /** Map the engine's own type name onto a cell family. */
  classifyType(dataType: string): CellKind;

  readonly introspection: IntrospectionSql;
}
