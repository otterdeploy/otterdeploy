import { describe, expect, test } from "vite-plus/test";

import { DDSketch } from "../ddsketch";

/** Deterministic lognormal latencies (µs) from a seeded LCG. */
function lognormal(seed: number, n: number): number[] {
  let s = seed;
  const rand = () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (s + 1) / 2_147_483_649;
  };
  return Array.from({ length: n }, () => {
    const z = Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
    return Math.exp(10 + 1.2 * z);
  });
}

describe("DDSketch", () => {
  test("quantiles are within 1% relative error of the exact rank value at alpha = 1%", () => {
    const xs = lognormal(7, 20_000);
    const sketch = new DDSketch(0.01);
    for (const x of xs) sketch.add(x);
    const sorted = xs.toSorted((a, b) => a - b);
    for (const q of [0.5, 0.75, 0.9, 0.95, 0.99]) {
      const exact = sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
      const got = sketch.quantile(q) ?? 0;
      expect(Math.abs(got - exact) / exact).toBeLessThanOrEqual(0.01 + 1e-9);
    }
  });

  test("merge equals the sketch of the union, across encode/decode", () => {
    const xs = lognormal(3, 5_000);
    const whole = new DDSketch();
    const left = new DDSketch();
    const right = new DDSketch();
    for (const [i, x] of xs.entries()) {
      whole.add(x);
      (i % 2 === 0 ? left : right).add(x);
    }
    const merged = DDSketch.decode(left.encode()).unwrap();
    expect(merged.merge(DDSketch.decode(right.encode()).unwrap()).isOk()).toBe(true);
    expect(merged.encode()).toEqual(whole.encode());
    expect(merged.count()).toBe(5_000);
  });

  test("sketches of different accuracy refuse to merge", () => {
    expect(new DDSketch(0.01).merge(new DDSketch(0.02)).isErr()).toBe(true);
  });

  test("a corrupt or truncated blob is a typed error at the boundary", () => {
    expect(DDSketch.decode(Uint8Array.from([9, 0, 0])).isErr()).toBe(true);
    const full = new DDSketch();
    full.add(1234);
    full.add(98_765);
    const bytes = full.encode();
    expect(DDSketch.decode(bytes.slice(0, bytes.length - 1)).isErr()).toBe(true);
  });

  test("an empty sketch has no quantile", () => {
    expect(new DDSketch().quantile(0.5)).toBeNull();
  });
});
