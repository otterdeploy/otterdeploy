import { describe, expect, test } from "bun:test";

import { ABSENT, formatBytes } from "../format";

describe("formatBytes", () => {
  test("whole bytes render without a fraction", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  test("scales through the binary units", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatBytes(15 * 1024 ** 3)).toBe("15.0 GB");
    expect(formatBytes(2 * 1024 ** 4)).toBe("2.0 TB");
  });

  test("saturates at the largest unit instead of inventing one", () => {
    expect(formatBytes(1024 ** 5)).toBe("1.0 PB");
    expect(formatBytes(1024 ** 6)).toBe("1024.0 PB");
  });

  test("honours the decimals argument", () => {
    expect(formatBytes(1536, 0)).toBe("2 KB");
    expect(formatBytes(1536, 2)).toBe("1.50 KB");
    // `B` stays integral regardless — a fraction of a byte says nothing.
    expect(formatBytes(512, 2)).toBe("512 B");
  });

  test("a size we don't have is not a size of zero", () => {
    expect(formatBytes(null)).toBe(ABSENT);
    expect(formatBytes(undefined)).toBe(ABSENT);
    expect(formatBytes(Number.NaN)).toBe(ABSENT);
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe(ABSENT);
    expect(formatBytes(-2048)).toBe(ABSENT);
  });
});
