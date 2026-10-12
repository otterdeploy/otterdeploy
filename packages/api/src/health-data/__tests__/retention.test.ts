import { describe, expect, test } from "vite-plus/test";

import { DEFAULT_THRESHOLDS, pressureLevel } from "../retention";

const free = (pct: number) => ({ freeBytes: pct, totalBytes: 100 });

describe("disk pressure levels", () => {
  test("map the free fraction onto the four levels", () => {
    expect(pressureLevel(free(25), DEFAULT_THRESHOLDS)).toBe(0);
    expect(pressureLevel(free(19.9), DEFAULT_THRESHOLDS)).toBe(1);
    expect(pressureLevel(free(11.9), DEFAULT_THRESHOLDS)).toBe(2);
    expect(pressureLevel(free(5.9), DEFAULT_THRESHOLDS)).toBe(3);
  });

  test("an unreadable disk counts as full", () => {
    expect(pressureLevel({ freeBytes: 0, totalBytes: 0 }, DEFAULT_THRESHOLDS)).toBe(3);
  });
});
