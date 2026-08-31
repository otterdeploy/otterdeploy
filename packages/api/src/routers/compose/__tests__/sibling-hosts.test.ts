/**
 * od-tahh: a renamed stack child's siblings must still reach IT, not whoever
 * owns the bare name on the shared project network.
 *
 * The failure this pins was silent and cross-tenant: `autumn`'s `db` was
 * renamed to `autumn-db` on insert, its env still said `db`, and `db` resolved
 * to `authentik`'s postgres. Autumn crash-looped authenticating against another
 * stack's database while its REDIS_URL read another stack's redis.
 *
 * The other half of the suite matters just as much: a bare compose key is an
 * ordinary word. `POSTGRES_DB=db` is a database NAME. Rewriting it would break
 * the service this exists to fix, so those cases are pinned as no-ops.
 */
import { describe, expect, test } from "vite-plus/test";

import { rewriteSiblingHosts, siblingRenames } from "../sibling-hosts";

const renames = siblingRenames([
  { composeService: "db", internalHostname: "autumn-db" },
  { composeService: "redis", internalHostname: "autumn-redis" },
  { composeService: "server", internalHostname: "autumn-server" },
  // Kept its bare name: needs no entry, and must not produce a no-op rewrite.
  { composeService: "worker", internalHostname: "worker" },
]);

const rewrite = (key: string, value: string) => rewriteSiblingHosts(key, value, renames);

describe("siblingRenames", () => {
  test("carries only the children that were actually renamed", () => {
    expect([...renames.entries()]).toEqual([
      ["db", "autumn-db"],
      ["redis", "autumn-redis"],
      ["server", "autumn-server"],
    ]);
  });
});

describe("rewriteSiblingHosts", () => {
  test("rewrites the host of a connection URL, password and path untouched", () => {
    expect(rewrite("DATABASE_URL", "postgres://autumn:p@ss@db:5432/autumn")).toBe(
      "postgres://autumn:p@ss@autumn-db:5432/autumn",
    );
  });

  test("rewrites a URL with no userinfo", () => {
    expect(rewrite("REDIS_URL", "redis://redis:6379")).toBe("redis://autumn-redis:6379");
    expect(rewrite("API_URL", "http://server:3000/health")).toBe(
      "http://autumn-server:3000/health",
    );
  });

  test("rewrites host:port with no scheme", () => {
    expect(rewrite("ANYTHING", "db:5432")).toBe("autumn-db:5432");
  });

  test("rewrites a bare value only when the key says it is a host", () => {
    expect(rewrite("POSTGRES_HOST", "db")).toBe("autumn-db");
    expect(rewrite("HOST", "server")).toBe("autumn-server");
    expect(rewrite("REDIS_HOSTNAME", "redis")).toBe("autumn-redis");
  });

  test("leaves a bare value alone when the key does not vouch for it", () => {
    // The case that would break the very stack this fixes.
    expect(rewrite("POSTGRES_DB", "db")).toBe("db");
    expect(rewrite("POSTGRES_USER", "server")).toBe("server");
    expect(rewrite("NODE_ENV", "redis")).toBe("redis");
  });

  test("leaves a sibling that kept its bare name alone", () => {
    expect(rewrite("WORKER_URL", "http://worker:8080")).toBe("http://worker:8080");
  });

  test("does not touch a name that merely appears inside a path or password", () => {
    expect(rewrite("DATABASE_URL", "postgres://u:db@autumn-db:5432/db")).toBe(
      "postgres://u:db@autumn-db:5432/db",
    );
    expect(rewrite("API_URL", "http://autumn-server:3000/db")).toBe("http://autumn-server:3000/db");
  });

  test("handles a comma-separated list part by part, padding preserved", () => {
    expect(rewrite("SEEDS", "db:5432, redis:6379")).toBe("autumn-db:5432, autumn-redis:6379");
  });

  test("is a no-op with no renames", () => {
    expect(rewriteSiblingHosts("POSTGRES_HOST", "db", new Map())).toBe("db");
  });

  test("leaves an unrelated host alone", () => {
    expect(rewrite("DATABASE_URL", "postgres://u:p@external.example.com:5432/x")).toBe(
      "postgres://u:p@external.example.com:5432/x",
    );
  });
});
