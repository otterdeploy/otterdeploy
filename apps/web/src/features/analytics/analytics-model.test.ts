import { describe, expect, test } from "vite-plus/test";

import {
  countryName,
  formatCount,
  formatShare,
  groupStatuses,
  seriesPoints,
} from "./analytics-model";

describe("seriesPoints", () => {
  const bucket = {
    t: "2026-08-16T12:00:00.000Z",
    requests: 100,
    botRequests: 10,
    s2xx: 90,
    s3xx: 2,
    s4xx: 5,
    s5xx: 3,
    sOther: 0,
    resBytes: 1_000,
    p50: 12,
    p95: 80,
    p99: 200,
  };

  test("picks values with real Date objects", () => {
    const points = seriesPoints([bucket], (b) => b.s4xx + b.s5xx);
    expect(points).toEqual([{ date: new Date(bucket.t), value: 8 }]);
  });

  test("keeps nulls (empty bucket = gap, not zero)", () => {
    const points = seriesPoints([{ ...bucket, p95: null }], (b) => b.p95);
    expect(points[0]?.value).toBeNull();
  });
});

describe("groupStatuses", () => {
  test("groups codes into ordered classes, ranked within", () => {
    const groups = groupStatuses([
      { key: "404", count: 5 },
      { key: "200", count: 90 },
      { key: "500", count: 1 },
      { key: "204", count: 4 },
      { key: "429", count: 9 },
    ]);
    expect(groups.map((g) => g.cls)).toEqual(["2xx", "4xx", "5xx"]);
    expect(groups[0]?.codes.map((c) => c.key)).toEqual(["200", "204"]);
    expect(groups[1]?.codes.map((c) => c.key)).toEqual(["429", "404"]);
    expect(groups[0]?.total).toBe(94);
  });

  test("status 0 and oddballs land apart, never vanish", () => {
    const groups = groupStatuses([
      { key: "0", count: 3 },
      { key: "999", count: 1 },
    ]);
    expect(groups).toEqual([
      {
        cls: "other",
        total: 4,
        codes: [
          { key: "0", count: 3 },
          { key: "999", count: 1 },
        ],
      },
    ]);
  });

  test("empty input yields no groups", () => {
    expect(groupStatuses([])).toEqual([]);
  });
});

describe("formatCount", () => {
  test("compacts by magnitude and trims trailing zeros", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(12_400)).toBe("12.4K");
    expect(formatCount(2_000)).toBe("2K");
    expect(formatCount(3_200_000)).toBe("3.2M");
  });
});

describe("formatShare", () => {
  test("never lies with 0.0% for real traffic", () => {
    expect(formatShare(1, 10_000)).toBe("<0.1%");
    expect(formatShare(0, 10_000)).toBe("0.0%");
    expect(formatShare(5, 0)).toBe("0%");
    expect(formatShare(4_367, 10_000)).toBe("43.7%");
  });
});

describe("countryName", () => {
  test("resolves ISO codes, passes non-code keys through", () => {
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("US")).toBe("United States");
    // Non-2-letter keys (the "other" overflow bucket) never hit Intl.
    expect(countryName("other")).toBe("other");
  });
});
