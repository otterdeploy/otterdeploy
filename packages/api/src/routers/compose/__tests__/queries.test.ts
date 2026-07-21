import { describe, expect, it } from "vite-plus/test";

import { friendlyServiceCollisionMessage, pgErrorInfo } from "../queries";

// Drizzle wraps postgres-js errors: the SQL text becomes the outer message and
// the real PostgresError (code + constraint) lives on `.cause`. Build both
// shapes so the reader is exercised the way it fails in production.
function wrappedPgError(code: string, constraint: string): Error {
  const cause = Object.assign(new Error("insert failed"), { code, constraint_name: constraint });
  return Object.assign(new Error(`Failed query: insert into "service_resource" (...)`), { cause });
}

describe("pgErrorInfo", () => {
  it("reads code + constraint from the cause chain", () => {
    const info = pgErrorInfo(wrappedPgError("23505", "service_resource_service_name_unique"));
    expect(info).toEqual({ code: "23505", constraint: "service_resource_service_name_unique" });
  });

  it("reads code + constraint off the top-level error too", () => {
    const err = Object.assign(new Error("boom"), {
      code: "23505",
      constraint: "service_resource_network_hostname_unique",
    });
    expect(pgErrorInfo(err)).toEqual({
      code: "23505",
      constraint: "service_resource_network_hostname_unique",
    });
  });

  it("returns nulls for a plain error", () => {
    expect(pgErrorInfo(new Error("nope"))).toEqual({ code: null, constraint: null });
  });
});

describe("friendlyServiceCollisionMessage", () => {
  it("maps a service-name collision to an actionable line naming the compose service", () => {
    const msg = friendlyServiceCollisionMessage(
      wrappedPgError("23505", "service_resource_service_name_unique"),
      "waves",
    );
    expect(msg).toContain('a service named "waves" already exists');
    expect(msg).not.toContain("insert into");
  });

  it("maps an internal-hostname collision (the standalone-vs-stack case)", () => {
    const msg = friendlyServiceCollisionMessage(
      wrappedPgError("23505", "service_resource_network_hostname_unique"),
      "waves",
    );
    expect(msg).toContain('internal hostname "waves"');
  });

  it("maps a public-domain collision", () => {
    const msg = friendlyServiceCollisionMessage(
      wrappedPgError("23505", "service_resource_public_domain_unique"),
      "web",
    );
    expect(msg).toContain("public domain");
  });

  it("returns null for a non-unique-violation so the raw error is surfaced", () => {
    expect(friendlyServiceCollisionMessage(wrappedPgError("23503", "some_fk"), "waves")).toBeNull();
    expect(friendlyServiceCollisionMessage(new Error("random failure"), "waves")).toBeNull();
  });

  it("returns null for a 23505 on an unrelated constraint", () => {
    expect(
      friendlyServiceCollisionMessage(wrappedPgError("23505", "some_other_unique"), "waves"),
    ).toBeNull();
  });
});
