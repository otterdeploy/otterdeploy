import { describe, expect, test } from "vite-plus/test";

import { formatAgo, formatDurationMs } from "./format-duration";

describe("formatDurationMs", () => {
  test("null and nonsense render as an en dash, never a fake zero", () => {
    expect(formatDurationMs(null)).toBe("–");
    expect(formatDurationMs(Number.NaN)).toBe("–");
    expect(formatDurationMs(-5)).toBe("–");
  });

  test("sub-minute readings are seconds only", () => {
    expect(formatDurationMs(0)).toBe("0s");
    expect(formatDurationMs(400)).toBe("0s");
    expect(formatDurationMs(47_000)).toBe("47s");
    expect(formatDurationMs(59_400)).toBe("59s");
  });

  test("minutes carry seconds: the spec reading", () => {
    expect(formatDurationMs(84_000)).toBe("1m 24s");
    expect(formatDurationMs(60_000)).toBe("1m 0s");
    expect(formatDurationMs(59 * 60_000 + 59_000)).toBe("59m 59s");
  });

  test("hours carry minutes, seconds dropped", () => {
    expect(formatDurationMs(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
    expect(formatDurationMs(3_600_000)).toBe("1h 0m");
  });

  test("rounding never produces 1h 60m", () => {
    expect(formatDurationMs(3_600_000 + 59 * 60_000 + 59_000)).toBe("2h 0m");
  });
});

describe("formatAgo", () => {
  test("collapses jitter under five seconds to now", () => {
    expect(formatAgo(0)).toBe("now");
    expect(formatAgo(4_900)).toBe("now");
  });

  test("steps through seconds, minutes, hours", () => {
    expect(formatAgo(12_000)).toBe("12 s ago");
    expect(formatAgo(3 * 60_000)).toBe("3 min ago");
    expect(formatAgo(2 * 3_600_000)).toBe("2 h ago");
  });
});
