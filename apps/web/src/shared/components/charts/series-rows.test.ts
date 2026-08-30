import { describe, expect, it } from "vite-plus/test";

import { applyFilter, seriesTotals, toLongRows, withGaps } from "./series-rows";

const KEYS = [
  { dataKey: "cpu", label: "CPU" },
  { dataKey: "mem", label: "Memory" },
];

describe("withGaps", () => {
  it("leaves an evenly sampled series alone", () => {
    const rows = [{ ts: 0 }, { ts: 30_000 }, { ts: 60_000 }];
    expect(withGaps(rows, 30_000)).toHaveLength(3);
  });

  it("tolerates ordinary scheduling jitter", () => {
    // 1.4x the interval is a late tick, not an outage. Breaking here would
    // shred a healthy line into fragments.
    const rows = [{ ts: 0 }, { ts: 42_000 }];
    expect(withGaps(rows, 30_000)).toHaveLength(2);
  });

  it("breaks the line once the gap exceeds 1.5x the cadence", () => {
    const rows = [{ ts: 0 }, { ts: 300_000 }];
    const out = withGaps(rows, 30_000);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ ts: 150_000, gap: true });
  });

  it("puts the break between the two real samples, not at either edge", () => {
    const out = withGaps([{ ts: 1000 }, { ts: 101_000 }], 10_000);
    expect(out[1]).toEqual({ ts: 51_000, gap: true });
  });

  it("handles several outages in one window", () => {
    const rows = [{ ts: 0 }, { ts: 200_000 }, { ts: 230_000 }, { ts: 900_000 }];
    const gaps = withGaps(rows, 30_000).filter((r) => "gap" in r);
    expect(gaps).toHaveLength(2);
  });

  it("draws a line when the sampler runs slower than nominal", () => {
    // The metrics sampler walks containers serially and skips a tick when a
    // pass overruns, so a 30s nominal cadence lands ~60s apart. Against a
    // fixed 45s threshold EVERY pair looked like an outage, every point became
    // its own one-point segment, and the chart rendered as loose dots.
    const rows = Array.from({ length: 12 }, (_, i) => ({ ts: i * 60_000 }));
    expect(withGaps(rows, 30_000).filter((r) => "gap" in r)).toHaveLength(0);
  });

  it("still breaks on a real outage inside a slow series", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => ({ ts: i * 60_000 })),
      { ts: 900_000 },
      { ts: 960_000 },
      { ts: 1_020_000 },
      { ts: 1_080_000 },
    ];
    expect(withGaps(rows, 30_000).filter((r) => "gap" in r)).toHaveLength(1);
  });

  it("does not read the cadence off too few samples", () => {
    // Two points one outage apart: trusting that single delta as "the cadence"
    // would declare the outage normal and draw straight through it.
    const out = withGaps([{ ts: 0 }, { ts: 300_000 }], 30_000);
    expect(out.filter((r) => "gap" in r)).toHaveLength(1);
  });

  it("does nothing without a known cadence", () => {
    // Aggregated rows have no fixed interval; inventing one would invent breaks.
    const rows = [{ ts: 0 }, { ts: 999_999 }];
    expect(withGaps(rows, 0)).toHaveLength(2);
  });
});

describe("toLongRows", () => {
  it("emits one row per series per sample, series-major", () => {
    const rows = [
      { ts: 0, cpu: 1, mem: 10 },
      { ts: 30_000, cpu: 2, mem: 20 },
    ];
    const long = toLongRows(rows, KEYS);
    expect(long).toHaveLength(4);
    expect(long.map((r) => r.series)).toEqual(["CPU", "CPU", "Memory", "Memory"]);
    expect(long.map((r) => r.value)).toEqual([1, 2, 10, 20]);
  });

  it("carries a real Date so the time scale spaces by elapsed time", () => {
    const long = toLongRows([{ ts: 1_700_000_000_000, cpu: 1, mem: 2 }], KEYS);
    expect(long[0].t).toBeInstanceOf(Date);
    expect(long[0].t.getTime()).toBe(1_700_000_000_000);
  });

  it("nulls the value at an injected gap in every series", () => {
    const rows = [
      { ts: 0, cpu: 1, mem: 10 },
      { ts: 300_000, cpu: 2, mem: 20 },
    ];
    const long = toLongRows(rows, KEYS, 30_000);
    expect(long.filter((r) => r.value === null)).toHaveLength(2);
  });

  it("passes a null field through as a break rather than zero", () => {
    // A counter reset already nulls the rate upstream; that must stay a gap.
    const long = toLongRows([{ ts: 0, cpu: null, mem: 5 }], KEYS);
    expect(long.find((r) => r.series === "CPU")?.value).toBeNull();
  });

  it("treats a missing field as a break, not as zero", () => {
    const long = toLongRows([{ ts: 0, mem: 5 }], KEYS);
    expect(long.find((r) => r.series === "CPU")?.value).toBeNull();
  });

  it("rejects a non-finite field rather than plotting NaN", () => {
    const long = toLongRows([{ ts: 0, cpu: Number.NaN, mem: 5 }], KEYS);
    expect(long.find((r) => r.series === "CPU")?.value).toBeNull();
  });
});

describe("seriesTotals", () => {
  it("sums magnitude per series, skipping gaps", () => {
    const long = toLongRows(
      [
        { ts: 0, cpu: 1, mem: 100 },
        { ts: 1000, cpu: 3, mem: 200 },
      ],
      KEYS,
    );
    const totals = seriesTotals(long);
    expect(totals.get("CPU")).toBe(4);
    expect(totals.get("Memory")).toBe(300);
  });

  it("ranks a swinging series by how much it moves, not by its net", () => {
    // A delta metric that nets to zero still dominates the chart visually.
    const long = toLongRows(
      [
        { ts: 0, cpu: -50, mem: 1 },
        { ts: 1000, cpu: 50, mem: 1 },
      ],
      KEYS,
    );
    expect(seriesTotals(long).get("CPU")).toBe(100);
  });
});

describe("applyFilter", () => {
  const labels = ["caddy", "postgres", "builder-worker"];

  it("lights everything when the filter is empty", () => {
    expect(applyFilter(labels, "")).toEqual(new Set(labels));
    expect(applyFilter(labels, "   ")).toEqual(new Set(labels));
  });

  it("lights only substring matches", () => {
    expect(applyFilter(labels, "build")).toEqual(new Set(["builder-worker"]));
  });

  it("is case-insensitive", () => {
    expect(applyFilter(labels, "CADDY")).toEqual(new Set(["caddy"]));
  });

  it("treats whitespace as OR across terms", () => {
    expect(applyFilter(labels, "caddy postgres")).toEqual(new Set(["caddy", "postgres"]));
  });

  it("lights everything again when nothing matches", () => {
    // Dimming the whole chart to answer a typo is worse than ignoring the typo.
    expect(applyFilter(labels, "zzz")).toEqual(new Set(labels));
  });
});
