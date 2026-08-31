import { describe, expect, test } from "vite-plus/test";

import { humanizeGoDuration } from "./duration";

describe("humanizeGoDuration", () => {
  test("multi-day durations read as days + hours", () => {
    expect(humanizeGoDuration("717h30m27s")).toBe("29d 21h");
    expect(humanizeGoDuration("720h0m0s")).toBe("30d");
  });

  test("sub-day durations read as hours + minutes", () => {
    expect(humanizeGoDuration("19h1m4s")).toBe("19h 1m");
    expect(humanizeGoDuration("2h0m0s")).toBe("2h");
    expect(humanizeGoDuration("42m10s")).toBe("42m");
    expect(humanizeGoDuration("30s")).toBe("<1m");
  });

  test("expired / negative durations", () => {
    expect(humanizeGoDuration("-5m0s")).toBe("expired");
    expect(humanizeGoDuration("0s")).toBe("expired");
  });

  test("a hundred-year ban reads as permanent, a 180-day one does not", () => {
    expect(humanizeGoDuration("876000h0m0s")).toBe("permanent");
    expect(humanizeGoDuration("875999h59m1s")).toBe("permanent");
    expect(humanizeGoDuration("4320h0m0s")).toBe("180d");
  });

  test("unparseable input passes through", () => {
    expect(humanizeGoDuration("forever")).toBe("forever");
    expect(humanizeGoDuration("")).toBe("");
  });
});
