/**
 * The query cache's read snapshots (packages/db cache-coherence.ts): what a
 * missed read saw, held until its put. Concurrent misses on one key must hand
 * every put the OLDEST counters, and a snapshot whose put never came must not
 * be held forever.
 */
import { ReadSnapshots } from "@otterdeploy/db/cache-coherence";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReadSnapshots", () => {
  test("a put takes the counters its read saw, once", () => {
    const snapshots = new ReadSnapshots();
    snapshots.record("k", ["service"], ["4"]);
    expect(snapshots.take("k")?.gens).toEqual(["4"]);
    expect(snapshots.take("k")).toBeUndefined();
  });

  test("concurrent misses on one key share the oldest counter per table", () => {
    const snapshots = new ReadSnapshots();
    snapshots.record("k", ["service", "project"], ["4", "9"]);
    snapshots.record("k", ["service", "project"], ["5", "8"]);
    expect(snapshots.take("k")?.gens).toEqual(["4", "8"]);
    // The second reader still has its share, with the same oldest counters.
    expect(snapshots.take("k")?.gens).toEqual(["4", "8"]);
    expect(snapshots.take("k")).toBeUndefined();
  });

  test("a put that does not use its snapshot still consumes it", () => {
    const snapshots = new ReadSnapshots();
    snapshots.record("k", ["service"], ["1"]);
    expect(snapshots.take("k", false)).toBeUndefined();
    expect(snapshots.take("k")).toBeUndefined();
  });

  test("snapshots whose put never came are swept once they are old", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const snapshots = new ReadSnapshots();
    for (let i = 0; i < 1_000; i++) snapshots.record(`stale-${i}`, ["service"], ["1"]);
    // Four minutes on: not yet old enough to drop.
    now.mockReturnValue(4 * 60 * 1000);
    snapshots.record("fresh-a", ["service"], ["1"]);
    expect(snapshots.take("stale-0")).toBeDefined();
    // Past five minutes: the next record sweeps every abandoned one.
    now.mockReturnValue(5 * 60 * 1000 + 1);
    snapshots.record("fresh-b", ["service"], ["1"]);
    expect(snapshots.take("stale-1")).toBeUndefined();
    expect(snapshots.take("fresh-a")).toBeDefined();
    expect(snapshots.take("fresh-b")).toBeDefined();
  });
});
