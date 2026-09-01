import { describe, expect, test } from "bun:test";

import { ABSENT, formatBytes } from "./format";

describe("formatBytes", () => {
  test("picks the unit by power of 1024", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 ** 3, 0)).toBe("3 GB");
  });

  test("never indexes below the byte unit for fractional values", () => {
    // A 0–1 B/s chart axis hands the formatter ticks like 0.8; that used to
    // read "819.2 undefined".
    expect(formatBytes(0.8)).toBe("1 B");
    expect(formatBytes(0.2)).toBe("0 B");
  });

  test("absent and invalid input read as absent", () => {
    expect(formatBytes(null)).toBe(ABSENT);
    expect(formatBytes(undefined)).toBe(ABSENT);
    expect(formatBytes(-1)).toBe(ABSENT);
    expect(formatBytes(Number.NaN)).toBe(ABSENT);
  });
});
