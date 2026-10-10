/**
 * A build helper's statement that never answers fails the build
 * instead of leaving the helper to drain its event loop and exit 1 "without
 * reporting a failure". Driven against a stand-in for Bun's SQL client whose
 * statement never settles (the shape packages/api's query-deadline test uses),
 * wrapped the way packages/db wraps the real pool.
 */
import { QueryDeadlineError, withQueryDeadlines } from "@otterdeploy/db/query-deadline";
import { describe, expect, test } from "bun:test";

import { BUILD_STATEMENT_TIMEOUT_MS, inBuildScope } from "../build-scope";

/** A Bun SQL query that never answers: a dropped promise, a silent peer. */
function silentClient() {
  const never = new Promise<unknown>(() => {
    // never settles
  });
  const query = {
    // oxlint-disable-next-line unicorn/no-thenable -- models Bun's SQL Query, which IS a lazy thenable
    then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      never.then(onFulfilled, onRejected),
  };
  return withQueryDeadlines((_strings: TemplateStringsArray) => query);
}

describe("inBuildScope", () => {
  test("a statement that never answers rejects with QueryDeadlineError, so the pipeline can fail it", async () => {
    const sql = silentClient();
    const outcome = await inBuildScope(async () => {
      await sql`update deployment set image = 'x'`;
      return "settled";
    }, 50).then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, value: error }),
    );

    expect(outcome.ok).toBe(false);
    expect(QueryDeadlineError.is(outcome.value)).toBe(true);
  });

  test("the helper's deadline is far above any real pipeline statement, and finite", () => {
    expect(BUILD_STATEMENT_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(Number.isFinite(BUILD_STATEMENT_TIMEOUT_MS)).toBe(true);
  });
});
