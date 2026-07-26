import { describe, expect, it } from "vite-plus/test";

import { ABSENT, elapsed, formatBytes, orAbsent, relativeTime, shortId, shortSha } from "./format";

describe("relativeTime", () => {
  it("reads as past for a past timestamp", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(iso)).toBe("5m ago");
  });

  it("reads as future for a future timestamp", () => {
    // The unified helper replaced a one-directional version that rendered
    // certificate expiry as "30d ago".
    const iso = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect(relativeTime(iso)).toBe("in 30d");
  });

  it("rolls up through minutes, hours and days", () => {
    const ago = (ms: number) => relativeTime(new Date(Date.now() - ms).toISOString());
    expect(ago(45 * 60_000)).toBe("45m ago");
    expect(ago(3 * 3_600_000)).toBe("3h ago");
    expect(ago(2 * 86_400_000)).toBe("2d ago");
  });
});

describe("shortId", () => {
  it("keeps the type prefix and truncates only the entropy", () => {
    expect(shortId("dpl_01hxk2mqabcdefgh")).toBe("dpl_01hxk2mq");
  });

  it("falls back to a plain slice when there is no prefix", () => {
    expect(shortId("0123456789abcdef")).toBe("01234567");
  });

  it("leaves an already-short id intact", () => {
    expect(shortId("bak_123")).toBe("bak_123");
  });
});

describe("shortSha", () => {
  it("abbreviates to git's conventional 7 characters", () => {
    expect(shortSha("1234567890abcdef")).toBe("1234567");
  });

  it("returns empty for a missing sha rather than 'null'", () => {
    expect(shortSha(null)).toBe("");
    expect(shortSha(undefined)).toBe("");
  });
});

describe("formatBytes", () => {
  it("uses binary units, matching the 1024 divisor", () => {
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MiB");
  });

  it("drops the fraction once the number is large enough not to need it", () => {
    expect(formatBytes(18 * 1024 * 1024 * 1024)).toBe("18 GiB");
  });

  it("reports raw bytes without a decimal", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("handles negatives and absent values", () => {
    expect(formatBytes(-2048)).toBe("-2.0 KiB");
    expect(formatBytes(null)).toBe(ABSENT);
    expect(formatBytes(Number.NaN)).toBe(ABSENT);
  });
});

describe("elapsed", () => {
  it("renders a span, not a relative time", () => {
    const from = "2026-01-01T00:00:00.000Z";
    expect(elapsed(from, "2026-01-01T00:00:12.000Z")).toBe("12s");
    expect(elapsed(from, "2026-01-01T00:01:24.000Z")).toBe("1m24s");
    expect(elapsed(from, "2026-01-01T00:05:00.000Z")).toBe("5m");
    expect(elapsed(from, "2026-01-01T02:05:00.000Z")).toBe("2h5m");
  });

  it("is empty when the deploy has not finished", () => {
    expect(elapsed("2026-01-01T00:00:00.000Z", null)).toBe("");
  });
});

describe("orAbsent", () => {
  it("marks empty values explicitly instead of leaving a blank cell", () => {
    expect(orAbsent("")).toBe(ABSENT);
    expect(orAbsent(null)).toBe(ABSENT);
    expect(orAbsent("web")).toBe("web");
  });
});
