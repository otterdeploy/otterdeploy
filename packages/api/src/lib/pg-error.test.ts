import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, test } from "vite-plus/test";

import {
  asPgError,
  isForeignKeyViolation,
  isNotNullViolation,
  isRetryablePgError,
  isUniqueViolation,
  pgConstraint,
  PgErrorCode,
  pgErrorCode,
  pgErrorInfo,
} from "./pg-error";

/**
 * bun-sql's PostgresError: SQLSTATE on `errno`, `code` a fixed constant.
 * Field values copied from a real duplicate-key failure observed against the
 * running control plane, so the fixture can't drift from the driver.
 */
function bunPgError(errno: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint "x_unique"'), {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno,
    ...extra,
  });
}

/** node-postgres / postgres.js: SQLSTATE on `code`. */
function nodePgError(code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error("duplicate key value"), { code, ...extra });
}

const wrapped = (cause: Error) => new DrizzleQueryError("insert into ...", [], cause);

describe("pgErrorCode — driver field differences", () => {
  test("reads bun-sql's errno, not its non-SQLSTATE code", () => {
    expect(pgErrorCode(bunPgError("23505"))).toBe("23505");
  });

  test("reads node-postgres/postgres.js code", () => {
    expect(pgErrorCode(nodePgError("23505"))).toBe("23505");
  });

  test("unwraps DrizzleQueryError to reach the driver error", () => {
    expect(pgErrorCode(wrapped(bunPgError("23505")))).toBe("23505");
    expect(pgErrorCode(wrapped(nodePgError("23503")))).toBe("23503");
  });

  test("is null for anything that isn't a database failure", () => {
    expect(pgErrorCode(new Error("kaboom"))).toBeNull();
    expect(pgErrorCode(null)).toBeNull();
    expect(pgErrorCode(undefined)).toBeNull();
    expect(pgErrorCode("23505")).toBeNull();
    expect(asPgError(new TypeError("bug"))).toBeNull();
  });
});

describe("classification", () => {
  test("unique violation, on both drivers and through the wrapper", () => {
    expect(isUniqueViolation(bunPgError("23505"))).toBe(true);
    expect(isUniqueViolation(nodePgError("23505"))).toBe(true);
    expect(isUniqueViolation(wrapped(bunPgError("23505")))).toBe(true);
  });

  test("does not fire on a neighbouring integrity code", () => {
    // 23502 (not-null) shares the class prefix — the exact state has to match.
    expect(isUniqueViolation(bunPgError("23502"))).toBe(false);
    expect(isNotNullViolation(bunPgError("23502"))).toBe(true);
    expect(isForeignKeyViolation(bunPgError("23503"))).toBe(true);
  });

  test("transient failures are marked retryable, integrity ones are not", () => {
    expect(isRetryablePgError(bunPgError(PgErrorCode.DEADLOCK_DETECTED))).toBe(true);
    expect(isRetryablePgError(bunPgError(PgErrorCode.SERIALIZATION_FAILURE))).toBe(true);
    expect(isRetryablePgError(bunPgError(PgErrorCode.CONNECTION_FAILURE))).toBe(true);
    expect(isRetryablePgError(bunPgError(PgErrorCode.UNIQUE_VIOLATION))).toBe(false);
  });
});

describe("pgErrorInfo", () => {
  test("carries the constraint, table and detail a message can be built from", () => {
    const info = pgErrorInfo(
      wrapped(
        bunPgError("23505", {
          constraint: "server_org_host_unique",
          table: "server",
          detail: "Key (organization_id, host)=(org_1, 10.0.0.1) already exists.",
        }),
      ),
    );
    expect(info).not.toBeNull();
    expect(info?.code).toBe("23505");
    expect(info?.constraint).toBe("server_org_host_unique");
    expect(info?.table).toBe("server");
    expect(info?.detail).toContain("already exists");
  });

  test("absent fields come back null rather than undefined", () => {
    // A not-null violation names no constraint — callers branch on null.
    const info = pgErrorInfo(bunPgError("23502", { table: "server" }));
    expect(info?.constraint).toBeNull();
    expect(info?.column).toBeNull();
    expect(pgConstraint(bunPgError("23502"))).toBeNull();
  });

  test("is null for a non-database error", () => {
    expect(pgErrorInfo(new Error("nope"))).toBeNull();
  });
});
