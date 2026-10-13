/**
 * The correction-ledger evaluator against the design's worked examples
 * and interval rules. Every case is evaluated for all arrival orders where the
 * order could plausibly matter: the evaluator canonicalises its input.
 */
import { describe, expect, test } from "vite-plus/test";

import { evaluateMetricBuckets, evaluateProbeBuckets, report } from "../evaluate";
import { KIND, type LedgerRecord, MINUTE, type ProbeState, STATE } from "../model";

/** A ten-minute boundary standing in for "12:00". */
const T0 = 1_760_000_000_000 - (1_760_000_000_000 % (10 * MINUTE));
const at = (min: number) => T0 + min * MINUTE;
const TEN = 10 * MINUTE;

function obs(min: number, state: ProbeState, extra: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    t: at(min),
    boot: 1,
    seq: Math.round(min * 1000),
    kind: KIND.observation,
    state,
    uncMs: 0,
    ttlMs: 3 * MINUTE,
    latUs: state === STATE.healthy ? 20_000 : null,
    attUs: null,
    vals: null,
    ...extra,
  };
}

function marker(min: number, kind: LedgerRecord["kind"], seq: number): LedgerRecord {
  return { ...obs(min, STATE.unknown), kind, seq, latUs: null };
}

const minutes = (b: { durMs: readonly number[] } | undefined) => b?.durMs.map((d) => d / MINUTE);

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
  );
}

describe("worked example: TTL 3 min, report 12:00-12:10", () => {
  test("a delayed Healthy at 12:04 alone: Healthy [04,07), coverage 30%, strict uptime 100%", () => {
    const [b] = evaluateProbeBuckets([obs(4, STATE.healthy)], at(0), at(10), TEN);
    expect(minutes(b)).toEqual([3, 0, 0, 7]);
    expect(b && report([b])).toEqual({ d: TEN, coverage: 0.3, strictUptime: 1 });
  });

  test("then Down at 12:06: Healthy [04,06), Down [06,09), coverage 50%, uptime 40%, any order", () => {
    for (const order of permutations([obs(4, STATE.healthy), obs(6, STATE.down)])) {
      const [b] = evaluateProbeBuckets(order, at(0), at(10), TEN);
      expect(minutes(b)).toEqual([2, 0, 3, 5]);
      expect(b && report([b])).toEqual({ d: TEN, coverage: 0.5, strictUptime: 0.4 });
    }
  });

  test("duplicates in every arrival order give the same answer as one copy each", () => {
    const records = [obs(4, STATE.healthy), obs(6, STATE.down), obs(4, STATE.healthy)];
    for (const order of permutations(records)) {
      const [b] = evaluateProbeBuckets(order, at(0), at(10), TEN);
      expect(minutes(b)).toEqual([2, 0, 3, 5]);
    }
  });

  test("split buckets: Healthy 12:09 and Down 12:11 change both buckets", () => {
    for (const order of permutations([obs(11, STATE.down), obs(9, STATE.healthy)])) {
      const [a, b] = evaluateProbeBuckets(order, at(0), at(20), TEN);
      expect(minutes(a)).toEqual([1, 0, 0, 9]);
      expect(minutes(b)).toEqual([1, 0, 3, 6]);
    }
  });

  test("a predecessor older than the bucket still bounds it by its TTL", () => {
    const [b] = evaluateProbeBuckets([obs(-2, STATE.healthy)], at(0), at(10), TEN);
    expect(minutes(b)).toEqual([1, 0, 0, 9]);
  });

  test("a report with no known time has no uptime, never 100%", () => {
    const [b] = evaluateProbeBuckets([], at(0), at(10), TEN);
    expect(b && report([b])).toEqual({ d: TEN, coverage: 0, strictUptime: null });
  });
});

describe("uncertainty, markers and diagnostics", () => {
  test("uncertainty trims both edges; the overlap between neighbours is Unknown", () => {
    const u = 30_000;
    const [b] = evaluateProbeBuckets(
      [obs(6, STATE.down, { uncMs: u }), obs(4, STATE.healthy, { uncMs: u })],
      at(0),
      at(10),
      TEN,
    );
    // Healthy [04:30, 05:30), Down [06:30, 08:30)
    expect(b?.durMs).toEqual([MINUTE, 0, 2 * MINUTE, 7 * MINUTE]);
  });

  test("uncertainty over 5 minutes is diagnostic only: it neither asserts nor cuts", () => {
    const [b] = evaluateProbeBuckets(
      [obs(4, STATE.healthy), obs(5, STATE.down, { kind: KIND.diagnostic, uncMs: 6 * MINUTE })],
      at(0),
      at(10),
      TEN,
    );
    expect(minutes(b)).toEqual([3, 0, 0, 7]);
  });

  test("a gap marker blocks interpolation through it", () => {
    const [b] = evaluateProbeBuckets(
      [obs(4, STATE.healthy), marker(5, KIND.gapStart, -1)],
      at(0),
      at(10),
      TEN,
    );
    expect(minutes(b)).toEqual([1, 0, 0, 9]);
  });

  test("a boot marker ends the old boot's state; the new boot starts Unknown", () => {
    const [b] = evaluateProbeBuckets(
      [obs(4, STATE.healthy), marker(5, KIND.boot, -2), obs(8, STATE.healthy, { boot: 2, seq: 1 })],
      at(0),
      at(10),
      TEN,
    );
    expect(minutes(b)).toEqual([3, 0, 0, 7]);
  });

  test("a tombstone ends the reporting interval: time after it leaves D", () => {
    const [b] = evaluateProbeBuckets(
      [obs(4, STATE.healthy), marker(6, KIND.tombstone, -3)],
      at(0),
      at(10),
      TEN,
    );
    expect(minutes(b)).toEqual([2, 0, 0, 4]);
    expect(b && report([b]).d).toBe(6 * MINUTE);
  });

  test("maintenance is an overlay, excluded only when the report asks", () => {
    const records = [
      obs(1, STATE.down, { ttlMs: 20 * MINUTE }),
      marker(2, KIND.maintenanceStart, -4),
      marker(5, KIND.maintenanceEnd, -5),
    ];
    const [b] = evaluateProbeBuckets(records, at(0), at(10), TEN);
    // The start marker cuts the Down observation: Down [1,2), the window [2,5) is Unknown.
    expect(minutes(b)).toEqual([0, 0, 1, 9]);
    expect(b?.maintMs).toEqual([0, 0, 0, 3 * MINUTE]);
    expect(b && report([b]).d).toBe(TEN);
    expect(b && report([b], true).d).toBe(7 * MINUTE);
  });

  test("ties at one instant within a boot use sequence order (the later sequence wins)", () => {
    for (const order of permutations([
      obs(4, STATE.down, { seq: 2 }),
      obs(4, STATE.healthy, { seq: 1 }),
    ])) {
      const [b] = evaluateProbeBuckets(order, at(0), at(10), TEN);
      expect(minutes(b)).toEqual([0, 0, 3, 7]);
    }
  });

  test("failures and Unknown never become zero-millisecond latency", () => {
    const [b] = evaluateProbeBuckets(
      [
        obs(1, STATE.healthy),
        obs(2, STATE.down, { latUs: 0 }),
        obs(3, STATE.unknown, { latUs: 0 }),
      ],
      at(0),
      at(10),
      TEN,
    );
    expect(b?.n).toBe(3);
    expect(b?.sketch.count()).toBe(1);
    expect(b?.sketch.quantile(0)).toBeGreaterThan(19_000);
  });

  test("attempt latencies go to the attempt sketch, the final round to the round sketch", () => {
    const [b] = evaluateProbeBuckets(
      [obs(1, STATE.healthy, { latUs: 900, attUs: [5_000_000, 900] })],
      at(0),
      at(10),
      TEN,
    );
    expect(b?.sketch.count()).toBe(1);
    expect(b?.attemptSketch.count()).toBe(2);
  });
});

describe("metric buckets", () => {
  test("coverage follows the TTL rule; mean and max are over in-bucket samples", () => {
    const m = (min: number, v: number): LedgerRecord => ({
      ...obs(min, STATE.healthy, { ttlMs: MINUTE }),
      latUs: null,
      vals: [v, v * 2],
    });
    const [b] = evaluateMetricBuckets([m(5, 5), m(0, 1), m(0.5, 3)], at(0), at(10), TEN);
    expect(b?.n).toBe(3);
    expect(b?.coverageMs).toBe(2.5 * MINUTE);
    expect(b?.mean.slice(0, 2)).toEqual([3, 6]);
    expect(b?.max.slice(0, 2)).toEqual([5, 10]);
  });

  test("a value not measured this round is absent from its element, never a zero", () => {
    const m = (min: number, vals: (number | null)[]): LedgerRecord => ({
      ...obs(min, STATE.healthy, { ttlMs: MINUTE }),
      latUs: null,
      vals,
    });
    const [b] = evaluateMetricBuckets(
      [m(1, [4, null]), m(2, [8, null]), m(3, [6, 10])],
      at(0),
      at(10),
      TEN,
    );
    expect(b?.n).toBe(3);
    expect(b?.mean.slice(0, 3)).toEqual([6, 10, null]);
    expect(b?.max.slice(0, 3)).toEqual([8, 10, null]);
    // Per-element sample counts let parents weight each element exactly.
    expect(b?.count.slice(0, 3)).toEqual([3, 1, 0]);
  });
});
