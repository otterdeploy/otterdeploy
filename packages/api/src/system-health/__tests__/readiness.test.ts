import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

// The query chain models the real failure (a paused Postgres): the Redis
// query cache is warm, Postgres is hung. A read
// that goes through the cache answers at once; one that bypasses it
// (`$withCache(false)`) waits on Postgres, which never answers.
const postgres = { hung: false, queries: 0 };
function limitResult() {
  const cached = Promise.resolve([{ id: "res_cached" }]);
  return {
    // oxlint-disable-next-line unicorn/no-thenable -- models a Drizzle query builder, which IS a thenable: awaiting it runs the (cached) query.
    then: cached.then.bind(cached),
    $withCache: vi.fn((config: unknown) => {
      if (config !== false) return cached;
      postgres.queries++;
      return postgres.hung
        ? new Promise(() => {
            // Postgres paused: never answers.
          })
        : Promise.resolve([{ id: "res_live" }]);
    }),
  };
}
vi.mock("@otterdeploy/db", () => ({
  db: {
    select: () => ({ from: () => ({ limit: () => limitResult() }) }),
  },
}));
vi.mock("../../backups/scheduler", () => ({
  backupSchedulerLiveness: () => ({ healthy: true, lastTickAt: null }),
}));

import {
  checkReadiness,
  createDatabaseProbe,
  READINESS_QUERY_STALE_MS,
  READINESS_TIMEOUT_MS,
} from "../readiness";

beforeEach(() => {
  postgres.hung = false;
  postgres.queries = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("/health readiness", () => {
  // First: checkReadiness shares one module-level probe, and the hung query
  // of the next test stays in flight (by design) for the rest of the file.
  test("a healthy Postgres reads as ready, from the database not the cache", async () => {
    const result = await checkReadiness();
    expect(result).toMatchObject({ ok: true });
    expect(postgres.queries).toBe(1);
  });

  test("a hung Postgres reads as not ready even while the query cache is warm", async () => {
    postgres.hung = true;
    const pending = checkReadiness();
    await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
    expect(postgres.queries).toBe(1);
  });
});

describe("createDatabaseProbe", () => {
  function probeWith(query: () => Promise<unknown>) {
    let clock = 0;
    const probe = createDatabaseProbe({
      query,
      timeoutMs: READINESS_TIMEOUT_MS,
      staleMs: READINESS_QUERY_STALE_MS,
      now: () => clock,
    });
    return { probe, advance: (ms: number) => (clock += ms) };
  }

  test("concurrent checks share one in-flight query, each with its own deadline", async () => {
    const query = vi.fn(
      () =>
        new Promise(() => {
          // hung
        }),
    );
    const { probe } = probeWith(query);
    const checks = [probe(), probe(), probe()];
    await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    const results = await Promise.all(checks);
    expect(results.every((r) => r.isErr())).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("a settled query is not reused: the next check asks the database again", async () => {
    const query = vi.fn(() => Promise.resolve([]));
    const { probe } = probeWith(query);
    expect((await probe()).isOk()).toBe(true);
    expect((await probe()).isOk()).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  test("a query the driver never settles is abandoned once stale, so recovery is seen", async () => {
    let hung = true;
    const query = vi.fn(() =>
      hung
        ? new Promise(() => {
            // never settles
          })
        : Promise.resolve([]),
    );
    const { probe, advance } = probeWith(query);
    const first = probe();
    await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    expect((await first).isErr()).toBe(true);

    hung = false;
    advance(READINESS_QUERY_STALE_MS + 1);
    expect((await probe()).isOk()).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
