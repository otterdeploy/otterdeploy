import { describe, expect, test } from "vite-plus/test";

import { ServerDatabaseError } from "./errors";

// SQLSTATE classification itself is covered in ../../lib/pg-error.test.ts.
// This file only pins the error that carries a failure to the operator.

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
    // A driver error that isn't an Error instance still has to be readable.
    // Otherwise the message carries nothing and we're back to a blind 500.
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
