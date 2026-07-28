/**
 * Postgres error classification.
 *
 * One place that knows how to get from "something threw" to "which integrity
 * rule did we break, on which constraint" — so handlers can answer with a 409
 * that names the field instead of a 500 that names nothing.
 *
 * Two things make this less trivial than the snippets you'll find online:
 *
 * 1. **drizzle doesn't classify.** drizzle-orm 1.x exports only DrizzleError /
 *    DrizzleQueryError / TransactionRollbackError. The driver's error — the one
 *    carrying the SQLSTATE — is on `DrizzleQueryError.cause`.
 *
 * 2. **drivers disagree on the field.** node-postgres and postgres.js put the
 *    SQLSTATE on `code`; bun-sql (what we run) puts it on **`errno`** and sets
 *    `code` to the constant "ERR_POSTGRES_SERVER_ERROR". Every community
 *    example checks `code === "23505"`, which is silently always-false here —
 *    that's why unique violations used to surface as unexpected 500s. Both
 *    fields are accepted; Bun's `code` can never collide with a 5-digit state.
 *
 * Typed against Bun's own `SQL.PostgresError`, but narrowed structurally rather
 * than with `instanceof`: a runtime `import { SQL } from "bun"` would make this
 * module unloadable under the Node-based test runner (it is exactly why the
 * suites reaching db/client.ts fail to load). Keeping it type-only leaves this
 * a leaf that anything — including a unit test — can import.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

import type { SQL } from "bun";

import { DrizzleQueryError } from "drizzle-orm/errors";

/** SQLSTATEs we act on. Values are the codes themselves, so a raw string from
 *  a driver compares directly without a lookup table. */
export const PgErrorCode = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  NOT_NULL_VIOLATION: "23502",
  CHECK_VIOLATION: "23514",
  EXCLUSION_VIOLATION: "23P01",
  INVALID_TRANSACTION_STATE: "25000",
  SERIALIZATION_FAILURE: "40001",
  DEADLOCK_DETECTED: "40P01",
  CONNECTION_EXCEPTION: "08000",
  CONNECTION_DOES_NOT_EXIST: "08003",
  CONNECTION_FAILURE: "08006",
  UNDEFINED_TABLE: "42P01",
  UNDEFINED_COLUMN: "42703",
  INSUFFICIENT_PRIVILEGE: "42501",
} as const;

export type PgErrorCode = (typeof PgErrorCode)[keyof typeof PgErrorCode];

/** The parts of a Postgres failure worth surfacing. All optional — Postgres
 *  populates them per error class (a not-null violation has no `constraint`). */
export interface PgErrorInfo {
  code: string;
  constraint: string | null;
  table: string | null;
  column: string | null;
  detail: string | null;
  message: string;
}

/**
 * The driver's error, unwrapped from drizzle's query wrapper.
 *
 * Returns null for anything that isn't a database failure, so callers can
 * rethrow untouched rather than mislabelling an application bug as a DB error.
 */
export function asPgError(error: unknown): SQL.PostgresError | null {
  const driver = error instanceof DrizzleQueryError ? error.cause : error;
  if (!driver || typeof driver !== "object") return null;
  const candidate = driver as Partial<SQL.PostgresError>;
  const hasState = typeof candidate.errno === "string" || typeof candidate.code === "string";
  return hasState ? (candidate as SQL.PostgresError) : null;
}

/** The SQLSTATE, from whichever field this driver uses, or null. */
export function pgErrorCode(error: unknown): string | null {
  const pg = asPgError(error);
  if (!pg) return null;
  // `errno` first: on bun-sql `code` is a non-SQLSTATE constant.
  return pg.errno ?? (pg.code as string | undefined) ?? null;
}

/** Everything worth reporting about a database failure, or null if it isn't one. */
export function pgErrorInfo(error: unknown): PgErrorInfo | null {
  const pg = asPgError(error);
  const code = pgErrorCode(error);
  if (!pg || !code) return null;
  return {
    code,
    constraint: pg.constraint ?? null,
    table: pg.table ?? null,
    column: pg.column ?? null,
    detail: pg.detail ?? null,
    message: pg.message,
  };
}

/** True when `error` is the given SQLSTATE. */
export function isPgError(error: unknown, code: PgErrorCode): boolean {
  return pgErrorCode(error) === code;
}

export function isUniqueViolation(error: unknown): boolean {
  return isPgError(error, PgErrorCode.UNIQUE_VIOLATION);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return isPgError(error, PgErrorCode.FOREIGN_KEY_VIOLATION);
}

export function isNotNullViolation(error: unknown): boolean {
  return isPgError(error, PgErrorCode.NOT_NULL_VIOLATION);
}

export function isCheckViolation(error: unknown): boolean {
  return isPgError(error, PgErrorCode.CHECK_VIOLATION);
}

/** Transient failures worth retrying rather than reporting. */
export function isRetryablePgError(error: unknown): boolean {
  const code = pgErrorCode(error);
  return (
    code === PgErrorCode.SERIALIZATION_FAILURE ||
    code === PgErrorCode.DEADLOCK_DETECTED ||
    code === PgErrorCode.CONNECTION_EXCEPTION ||
    code === PgErrorCode.CONNECTION_DOES_NOT_EXIST ||
    code === PgErrorCode.CONNECTION_FAILURE
  );
}

/** The violated constraint's name, when the failure names one. */
export function pgConstraint(error: unknown): string | null {
  return asPgError(error)?.constraint ?? null;
}
