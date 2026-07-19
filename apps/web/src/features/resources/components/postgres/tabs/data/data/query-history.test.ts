import { describe, expect, it } from "vite-plus/test";

import type { QueryHistoryEntry } from "./query-history";

import { HISTORY_LIMIT, pushHistory } from "./query-history";

const entry = (n: number, p: Partial<QueryHistoryEntry> = {}): QueryHistoryEntry => ({
  id: `id-${n}`,
  sql: `SELECT ${n}`,
  ok: true,
  rowCount: 1,
  durationMs: 5,
  error: null,
  at: n,
  ...p,
});

describe("pushHistory", () => {
  it("prepends — newest first", () => {
    const ring = pushHistory(pushHistory([], entry(1)), entry(2));
    expect(ring.map((e) => e.id)).toEqual(["id-2", "id-1"]);
  });

  it("caps the ring at HISTORY_LIMIT, dropping the oldest", () => {
    let ring: QueryHistoryEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 7; i++) ring = pushHistory(ring, entry(i));
    expect(ring).toHaveLength(HISTORY_LIMIT);
    expect(ring[0]?.id).toBe(`id-${HISTORY_LIMIT + 6}`);
    expect(ring.at(-1)?.id).toBe("id-7");
  });

  it("keeps failures alongside successes (history is a log, not a set)", () => {
    const failed = entry(3, { ok: false, rowCount: null, durationMs: null, error: "boom" });
    const ring = pushHistory(pushHistory([], entry(2)), failed);
    expect(ring[0]).toMatchObject({ ok: false, error: "boom" });
    expect(ring).toHaveLength(2);
  });

  it("records re-runs of the same statement as separate entries", () => {
    const ring = pushHistory(pushHistory([], entry(1)), entry(2, { sql: "SELECT 1" }));
    expect(ring).toHaveLength(2);
  });

  it("does not mutate the previous ring", () => {
    const first = pushHistory([], entry(1));
    const snapshot = [...first];
    pushHistory(first, entry(2));
    expect(first).toEqual(snapshot);
  });
});
