import { describe, expect, test } from "vite-plus/test";

import { countryName, formatCount, formatShare, groupStatuses } from "./analytics-model";

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
