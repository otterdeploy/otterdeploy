import { describe, expect, it } from "vite-plus/test";

import type { HostTraffic } from "./route-traffic";

import { formatRps, summarizeTraffic } from "./route-traffic";

const traffic = (host: string, over?: Partial<HostTraffic>): HostTraffic => ({
  host,
  resourceId: null,
  isPrimary: true,
  rps: 2,
  errorRate: 0,
  p50: 10,
  p95: 40,
  ...over,
});

describe("formatRps", () => {
  it("scales precision with magnitude", () => {
    expect(formatRps(0.034)).toBe("0.03");
    expect(formatRps(42.13)).toBe("42.1");
    expect(formatRps(312.4)).toBe("312");
    expect(formatRps(1234)).toBe("1.2k");
  });
});

describe("summarizeTraffic", () => {
  it("returns null when no host saw traffic (chip is omitted)", () => {
    expect(summarizeTraffic(undefined)).toBeNull();
    expect(summarizeTraffic([])).toBeNull();
    expect(summarizeTraffic([traffic("a.example.com", { rps: 0 })])).toBeNull();
  });

  it("sums rps and takes the worst p95 across live hosts only", () => {
    const out = summarizeTraffic([
      traffic("a.example.com", { rps: 2, p95: 40 }),
      traffic("b.example.com", { rps: 3, p95: 220 }),
      traffic("quiet.example.com", { rps: 0, p95: 0 }),
    ]);
    expect(out).toEqual({ totalRps: 5, worstP95: 220 });
  });
});
