import { describe, expect, test } from "vite-plus/test";

// Imported from the leaf module: ../service/views re-exports this exact
// function now, but pulls in runtime/swarm (and therefore the DB) at import
// time, which a unit test must not need.
import { isUniqueViolation } from "../project/view-helpers";
import { ServerDatabaseError } from "./errors";

/** How drizzle actually surfaces a Postgres error: wrapped, code on `.cause`. */
function wrappedPgError(code: string): Error {
  const driver = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code,
    constraint: "server_org_host_unique",
  });
  return Object.assign(new Error('Failed query: insert into "server" ...'), { cause: driver });
}

describe("ServerDatabaseError", () => {
  test("carries the underlying driver message so the 500 is diagnosable", () => {
    const err = new ServerDatabaseError({
      operation: "server.provisionServer",
      cause: new Error('null value in column "ssh_user" violates not-null constraint'),
    });
    expect(err.message).toContain("server.provisionServer");
    expect(err.message).toContain("violates not-null constraint");
  });

  test("never degrades an object cause to [object Object]", () => {
    // A driver error that isn't an Error instance still has to be readable —
    // otherwise the message carries nothing and we're back to a blind 500.
    const withMessage = new ServerDatabaseError({
      operation: "op",
      cause: { message: "duplicate key", code: "23505" },
    });
    expect(withMessage.message).toContain("duplicate key");
    const plain = new ServerDatabaseError({ operation: "op", cause: { code: "23502" } });
    expect(plain.message).not.toContain("[object Object]");
    expect(plain.message).toContain("23502");
  });

  test("survives a non-Error cause without throwing", () => {
    expect(new ServerDatabaseError({ operation: "op", cause: "boom" }).message).toContain("boom");
    expect(new ServerDatabaseError({ operation: "op", cause: null }).message).toContain(
      "unknown error",
    );
  });
});

describe("isUniqueViolation — must see through drizzle's wrapper", () => {
  test("detects 23505 nested on .cause (the shape drizzle actually throws)", () => {
    // The service copy checked only the top-level code and so missed this,
    // misclassifying every real collision as an unexpected failure.
    expect(isUniqueViolation(wrappedPgError("23505"))).toBe(true);
  });

  test("still detects a bare top-level 23505", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
  });

  test("does not fire on a different SQLSTATE", () => {
    expect(isUniqueViolation(wrappedPgError("23502"))).toBe(false);
  });

  test("tolerates null/undefined/plain values", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});
