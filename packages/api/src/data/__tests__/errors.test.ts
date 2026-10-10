import { Result } from "better-result";
import { describe, expect, it } from "vite-plus/test";

import {
  DataError,
  dataError,
  describeUnreachable,
  resolveTargetOrDataError,
  toDataError,
} from "../errors";

const target = { label: "neon", host: "18.206.107.24", port: 5432 };

describe("describeUnreachable", () => {
  it("names the database the driver could not reach", () => {
    // Bun's own wording names no host; a workbench with five connections
    // cannot leave the reader to guess which one closed on us.
    const closed = describeUnreachable(dataError("unreachable", "Connection closed"), target);
    expect(closed.reason).toBe("unreachable");
    expect(closed.message).toBe("neon (18.206.107.24:5432): Connection closed");

    const slow = describeUnreachable(dataError("timeout", "Connection timeout after 10s"), target);
    expect(slow.message).toBe("neon (18.206.107.24:5432): Connection timeout after 10s");
  });

  it("leaves the engine's own errors untouched", () => {
    const query = dataError("query", 'column "stauts" does not exist');
    expect(describeUnreachable(query, target)).toBe(query);
    const denied = dataError("denied", "cannot execute UPDATE in a read-only transaction");
    expect(describeUnreachable(denied, target)).toBe(denied);
  });
});

describe("toDataError", () => {
  it("classifies a refused socket as unreachable and keeps the driver's words", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    const out = toDataError(err);
    expect(out.reason).toBe("unreachable");
    expect(out.message).toBe("connect ECONNREFUSED 127.0.0.1:5432");
  });

  it("classifies a wall-clock timeout as timeout", () => {
    expect(toDataError(new Error("Connection timeout after 10s")).reason).toBe("timeout");
  });
});

describe("resolveTargetOrDataError", () => {
  it("keeps a deliberate refusal typed", async () => {
    const refused = await resolveTargetOrDataError(async () => {
      throw dataError("not_found", "no such connection");
    });
    expect(refused.isErr() && refused.error.reason).toBe("not_found");
  });

  it("never turns the control plane's own failure into the user's QUERY_FAILED", async () => {
    // What a failed lookup of the connection row throws: drizzle's wrapper,
    // naming OUR table and parameters. Through toDataError this was a
    // "query" DataError, so the workbench showed it as the user's SQL error.
    const ours = new Error('Failed query: select "id" from "data_connection" where "id" = $1');
    const settled = await Result.tryPromise({
      try: () =>
        resolveTargetOrDataError(async () => {
          throw ours;
        }),
      catch: (cause) => cause,
    });
    expect(settled.isErr() && settled.error).toBe(ours);
    expect(toDataError(ours)).toBeInstanceOf(DataError);
  });

  it("passes a resolved target through", async () => {
    const resolved = await resolveTargetOrDataError(async () => ({ host: "db", port: 5432 }));
    expect(resolved.isOk() && resolved.value).toEqual({ host: "db", port: 5432 });
  });
});
