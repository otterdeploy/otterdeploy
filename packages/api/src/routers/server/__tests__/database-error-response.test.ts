/**
 * A failed server-row write answers oRPC's generic INTERNAL_SERVER_ERROR: the
 * driver's text (SQL and its parameters) stays in the request log. Capacity
 * values an int4 column cannot hold are refused by the input schema instead of
 * reaching the insert.
 */
import { ORPCError } from "@orpc/server";
import { createRequestLogger } from "evlog";
import { describe, expect, it, vi } from "vite-plus/test";

import { serverContract } from "../contract";
import { createDatabaseFailure, ServerDatabaseError } from "../errors";

describe("createDatabaseFailure", () => {
  it("logs the driver error and answers without its text", () => {
    const log = createRequestLogger({ method: "TEST", path: "/server" });
    const logged = vi.spyOn(log, "error");
    const error = new ServerDatabaseError({
      operation: "create server",
      cause: new Error('Failed query: insert into "server" ("host") values ($1)\nparams: 10.0.0.5'),
    });

    const answer = createDatabaseFailure(log, error);

    expect(answer).toBeInstanceOf(ORPCError);
    expect(answer.code).toBe("INTERNAL_SERVER_ERROR");
    expect(answer.message).not.toContain("Failed query");
    expect(answer.message).not.toContain("10.0.0.5");
    expect(answer.cause).toBe(error);
    // By identity: a TaggedError is iterable (Result.gen), which deep equality
    // would walk.
    expect(logged.mock.calls[0]?.[0]).toBe(error);
    expect(logged.mock.calls[0]?.[1]).toEqual({ step: "create server" });
  });
});

describe("server.create capacity bounds", () => {
  const validate = async (capacity: Record<string, number>) => {
    const schema = serverContract.create["~orpc"].inputSchema;
    if (!schema) throw new Error("server.create has no input schema");
    return schema["~standard"].validate({ name: "node", host: "10.0.0.1", ...capacity });
  };

  it("accepts the largest int4 value", async () => {
    const result = await validate({ cpuTotal: 2_147_483_647 });
    expect(result.issues).toBeUndefined();
  });

  it.each(["cpuTotal", "memTotalGb", "diskTotalGb"])(
    "refuses %s beyond int4 at validation",
    async (field) => {
      const result = await validate({ [field]: 2_147_483_648 });
      expect(result.issues?.length).toBeGreaterThan(0);
    },
  );
});
