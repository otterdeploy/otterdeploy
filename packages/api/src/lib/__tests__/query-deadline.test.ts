/**
 * The per-request statement deadline (packages/db query-deadline.ts), against
 * a stand-in for Bun's SQL client: a tagged-template function returning lazy
 * thenable queries with `values()`, plus `unsafe` and `begin`.
 */
import {
  QueryDeadlineError,
  runWithQueryDeadline,
  withQueryDeadlines,
} from "@otterdeploy/db/query-deadline";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

interface FakeQuery {
  then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => unknown;
  finally: (onFinally?: () => void) => unknown;
  values: () => FakeQuery;
}

/** A query that answers `rows` after `answerAfterMs`, or never (null). */
function fakeQuery(rows: unknown, answerAfterMs: number | null): FakeQuery {
  const answer =
    answerAfterMs === null
      ? new Promise<unknown>(() => {
          // a silent connection: never answers
        })
      : new Promise<unknown>((resolve) => setTimeout(() => resolve(rows), answerAfterMs));
  const query: FakeQuery = {
    // oxlint-disable-next-line unicorn/no-thenable -- models Bun's SQL Query, which IS a lazy thenable
    then: (onFulfilled, onRejected) => answer.then(onFulfilled, onRejected),
    finally: (onFinally) => answer.finally(onFinally),
    values: () => query,
  };
  return query;
}

function fakeClient(answerAfterMs: number | null) {
  const client = (_strings: TemplateStringsArray, ..._values: unknown[]) =>
    fakeQuery([{ id: 1 }], answerAfterMs);
  return Object.assign(client, {
    unsafe: (_text: string, _params?: unknown[]) => fakeQuery([{ id: 2 }], answerAfterMs),
    begin: async (fn: (tx: typeof client) => Promise<unknown>) => fn(client),
  });
}

/** Settle under fake timers; null when it is still pending after `ms`. */
async function settleWithin(promise: Promise<unknown>, ms: number) {
  const box: { outcome: { ok: boolean; value: unknown } | null } = { outcome: null };
  promise.then(
    (value) => {
      box.outcome = { ok: true, value };
    },
    (value: unknown) => {
      box.outcome = { ok: false, value };
    },
  );
  await vi.advanceTimersByTimeAsync(ms);
  return box.outcome;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("withQueryDeadlines", () => {
  test("inside a request scope a silent statement fails with QueryDeadlineError", async () => {
    const sql = withQueryDeadlines(fakeClient(null));
    const pending = runWithQueryDeadline(1_000, async () => sql`select 1`.values());
    const early = await settleWithin(pending, 999);
    expect(early).toBeNull();
    const outcome = await settleWithin(pending, 1);
    expect(outcome?.ok).toBe(false);
    expect(QueryDeadlineError.is(outcome?.value)).toBe(true);
  });

  test("outside a scope nothing changes: background work keeps its long statements", async () => {
    const sql = withQueryDeadlines(fakeClient(60_000));
    const pending = (async () => sql`select pg_sleep(60)`)();
    expect(await settleWithin(pending, 59_999)).toBeNull();
    expect(await settleWithin(pending, 1)).toEqual({ ok: true, value: [{ id: 1 }] });
  });

  test("a statement that answers inside the deadline answers normally", async () => {
    const sql = withQueryDeadlines(fakeClient(10));
    const pending = runWithQueryDeadline(1_000, async () => sql.unsafe("select 2", []));
    expect(await settleWithin(pending, 10)).toEqual({ ok: true, value: [{ id: 2 }] });
  });

  test("statements inside a transaction are bounded too", async () => {
    const sql = withQueryDeadlines(fakeClient(null));
    const pending = runWithQueryDeadline(1_000, () =>
      sql.begin(async (tx) => tx`update project set name = 'x'`),
    );
    const outcome = await settleWithin(pending, 1_000);
    expect(QueryDeadlineError.is(outcome?.value)).toBe(true);
  });

  test("then() without a rejection handler and finally() reject with the deadline error", async () => {
    const sql = withQueryDeadlines(fakeClient(null));
    const onFinally = vi.fn();
    const chained = runWithQueryDeadline(1_000, () => {
      const query = sql`select 1`;
      return Promise.all([
        new Promise((resolve, reject) => {
          void Promise.resolve(query.then((rows) => rows)).then(resolve, reject);
        }),
        query.finally(onFinally),
      ]);
    });
    const outcome = await settleWithin(chained, 1_000);
    expect(QueryDeadlineError.is(outcome?.value)).toBe(true);
    expect(onFinally).toHaveBeenCalled();
  });
});
