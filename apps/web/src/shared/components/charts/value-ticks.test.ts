/**
 * A count axis ticks on whole numbers.
 *
 * The live tour found the Analytics visitors chart labelled
 * `0 · 0.2 · 0.4 · 0.6 · 0.8 · 1` over an empty week: fractions of a person.
 */
import { describe, expect, it } from "vite-plus/test";

import { peakValue, toLongRows } from "./series-rows";
import { countTicks } from "./value-ticks";

describe("countTicks", () => {
  it("reads 0 and 1 over an empty series, not five fractions", () => {
    expect(countTicks(0)).toEqual({ values: [0, 1], top: 1 });
    expect(countTicks(1)).toEqual({ values: [0, 1], top: 1 });
  });

  it("only ever ticks whole numbers, and tops out at or above the peak", () => {
    for (const peak of [2, 3, 7, 13, 99, 130, 1_234, 98_765]) {
      const { values, top } = countTicks(peak);
      expect(values.every(Number.isInteger)).toBe(true);
      expect(top).toBeGreaterThanOrEqual(peak);
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBe(top);
      // About four steps, never a wall of them.
      expect(values.length).toBeLessThanOrEqual(6);
    }
  });

  it("steps on 1, 2, 5 and their powers of ten", () => {
    expect(countTicks(7).values).toEqual([0, 2, 4, 6, 8]);
    expect(countTicks(130).values).toEqual([0, 50, 100, 150]);
  });

  it("treats a non-finite or negative peak as empty", () => {
    expect(countTicks(Number.NaN).top).toBe(1);
    expect(countTicks(-4).top).toBe(1);
  });
});

describe("peakValue", () => {
  const rows = [
    { ts: 0, a: 3, b: 4 },
    { ts: 1, a: 5, b: 1 },
  ];
  const long = toLongRows(rows, [
    { dataKey: "a", label: "a" },
    { dataKey: "b", label: "b" },
  ]);

  it("is the largest value when series overlay", () => {
    expect(peakValue(long, false)).toBe(5);
  });

  it("is the largest per-instant total when series stack", () => {
    expect(peakValue(long, true)).toBe(7);
  });
});
