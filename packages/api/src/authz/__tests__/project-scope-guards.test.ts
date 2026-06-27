import { ORPCError } from "@orpc/server";
import { describe, expect, test } from "bun:test";

// The guards module imports `@otterdeploy/db`, whose client validates the full
// server env at import time. Satisfy the required vars before the dynamic
// import below so the module graph loads (no real DB is ever touched — every
// guard takes an injected `client`). Same pattern as tokens.test.ts.
process.env.DATABASE_URL ??= "postgres://test/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.RESEND_API_KEY ??= "test-resend-key";

const {
  enforceBackupScope,
  enforceEnvScope,
  enforceProjectScope,
  enforceResourceScope,
  enforceScheduleScope,
} = await import("../project-scope-guards");
import type { ApiKeyActor } from "../../context";
import type { Context } from "../../context";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Minimal context factory — only the fields the guards read. The rest of the
 *  Context surface is irrelevant to project-scope enforcement, so we cast. */
function ctx(apiKey: ApiKeyActor | null, activeOrganizationId = "org_1"): Context {
  return { apiKey, activeOrganizationId } as unknown as Context;
}

function selectedKey(projectIds: string[]): ApiKeyActor {
  return {
    id: "key_1",
    permissions: null,
    referenceId: "org_1",
    projectScope: "selected",
    projectIds,
  };
}

const allKey: ApiKeyActor = {
  id: "key_all",
  permissions: null,
  referenceId: "org_1",
  projectScope: "all",
};

/** A db.select(...) mock that resolves to `rows` and records whether it was
 *  ever invoked (so we can assert the no-op paths skip the DB entirely). The
 *  chain mirrors drizzle's builder: .select().from().innerJoin?().where().limit()
 *  is awaited as a thenable. */
function dbReturning(rows: Array<{ projectId: string | null }>) {
  let queried = false;
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.from = passthrough;
  chain.innerJoin = passthrough;
  chain.where = passthrough;
  chain.limit = () => Promise.resolve(rows);
  const client = {
    select: () => {
      queried = true;
      return chain;
    },
  };
  return { client: client as never, wasQueried: () => queried };
}

// ---------------------------------------------------------------------------
// enforceProjectScope (pure, no DB)
// ---------------------------------------------------------------------------

describe("enforceProjectScope", () => {
  test("selected key, in-scope project ⇒ allowed (no throw)", () => {
    expect(() => enforceProjectScope(ctx(selectedKey(["proj_1"])), "proj_1")).not.toThrow();
  });

  test("selected key, out-of-scope project ⇒ FORBIDDEN", () => {
    try {
      enforceProjectScope(ctx(selectedKey(["proj_1"])), "proj_2");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ORPCError);
      expect((err as ORPCError<string, unknown>).code).toBe("FORBIDDEN");
    }
  });

  test("session actor (no key) ⇒ no-op", () => {
    expect(() => enforceProjectScope(ctx(null), "proj_2")).not.toThrow();
  });

  test("scope 'all' key ⇒ no-op", () => {
    expect(() => enforceProjectScope(ctx(allKey), "proj_2")).not.toThrow();
  });

  test("falsy projectId ⇒ no-op (can't determine project)", () => {
    expect(() => enforceProjectScope(ctx(selectedKey(["proj_1"])), null)).not.toThrow();
    expect(() => enforceProjectScope(ctx(selectedKey(["proj_1"])), undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// enforceResourceScope
// ---------------------------------------------------------------------------

describe("enforceResourceScope", () => {
  test("resolves resource→project, in-scope ⇒ allowed", async () => {
    const { client } = dbReturning([{ projectId: "proj_1" }]);
    expect(
      enforceResourceScope(ctx(selectedKey(["proj_1"])), "res_1" as never, client),
    ).resolves.toBeUndefined();
  });

  test("resolves resource→project, out-of-scope ⇒ FORBIDDEN", async () => {
    const { client } = dbReturning([{ projectId: "proj_2" }]);
    expect(
      enforceResourceScope(ctx(selectedKey(["proj_1"])), "res_1" as never, client),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("resource not found (wrong org) ⇒ no-op (handler's NOT_FOUND fires)", async () => {
    const { client } = dbReturning([]);
    expect(
      enforceResourceScope(ctx(selectedKey(["proj_1"])), "res_1" as never, client),
    ).resolves.toBeUndefined();
  });

  test("session actor ⇒ skips DB entirely", async () => {
    const { client, wasQueried } = dbReturning([{ projectId: "proj_2" }]);
    await enforceResourceScope(ctx(null), "res_1" as never, client);
    expect(wasQueried()).toBe(false);
  });

  test("scope 'all' key ⇒ skips DB entirely", async () => {
    const { client, wasQueried } = dbReturning([{ projectId: "proj_2" }]);
    await enforceResourceScope(ctx(allKey), "res_1" as never, client);
    expect(wasQueried()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// enforceBackupScope
// ---------------------------------------------------------------------------

describe("enforceBackupScope", () => {
  test("resolves backup→resource→project, in-scope ⇒ allowed", async () => {
    const { client } = dbReturning([{ projectId: "proj_1" }]);
    expect(
      enforceBackupScope(ctx(selectedKey(["proj_1"])), "backup_1" as never, client),
    ).resolves.toBeUndefined();
  });

  test("out-of-scope ⇒ FORBIDDEN", async () => {
    const { client } = dbReturning([{ projectId: "proj_9" }]);
    expect(
      enforceBackupScope(ctx(selectedKey(["proj_1"])), "backup_1" as never, client),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("not found ⇒ no-op", async () => {
    const { client } = dbReturning([]);
    expect(
      enforceBackupScope(ctx(selectedKey(["proj_1"])), "backup_1" as never, client),
    ).resolves.toBeUndefined();
  });

  test("session actor ⇒ skips DB", async () => {
    const { client, wasQueried } = dbReturning([{ projectId: "proj_9" }]);
    await enforceBackupScope(ctx(null), "backup_1" as never, client);
    expect(wasQueried()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// enforceScheduleScope
// ---------------------------------------------------------------------------

describe("enforceScheduleScope", () => {
  test("project-scoped schedule, out-of-scope ⇒ FORBIDDEN", async () => {
    const { client } = dbReturning([{ projectId: "proj_9" }]);
    expect(
      enforceScheduleScope(ctx(selectedKey(["proj_1"])), "sched_1" as never, client),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("org-wide schedule (null projectId) ⇒ no-op (can't pin a project)", async () => {
    const { client } = dbReturning([{ projectId: null }]);
    expect(
      enforceScheduleScope(ctx(selectedKey(["proj_1"])), "sched_1" as never, client),
    ).resolves.toBeUndefined();
  });

  test("not found ⇒ no-op", async () => {
    const { client } = dbReturning([]);
    expect(
      enforceScheduleScope(ctx(selectedKey(["proj_1"])), "sched_1" as never, client),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// enforceEnvScope
// ---------------------------------------------------------------------------

describe("enforceEnvScope", () => {
  test("project env, in-scope ⇒ allowed", async () => {
    const { client } = dbReturning([{ projectId: "proj_1" }]);
    expect(
      enforceEnvScope(ctx(selectedKey(["proj_1"])), "env_1" as never, client),
    ).resolves.toBeUndefined();
  });

  test("project env, out-of-scope ⇒ FORBIDDEN", async () => {
    const { client } = dbReturning([{ projectId: "proj_2" }]);
    expect(
      enforceEnvScope(ctx(selectedKey(["proj_1"])), "env_1" as never, client),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("standalone/org env (not joinable) ⇒ no-op", async () => {
    const { client } = dbReturning([]);
    expect(
      enforceEnvScope(ctx(selectedKey(["proj_1"])), "env_1" as never, client),
    ).resolves.toBeUndefined();
  });

  test("scope 'all' key ⇒ skips DB", async () => {
    const { client, wasQueried } = dbReturning([{ projectId: "proj_2" }]);
    await enforceEnvScope(ctx(allKey), "env_1" as never, client);
    expect(wasQueried()).toBe(false);
  });
});
