import { describe, expect, it } from "vite-plus/test";

import { hasHeadroom } from "./disk-guard";

const GB = 1024 ** 3;

describe("hasHeadroom", () => {
  it("never blocks when free disk is unreadable (null → don't guess)", () => {
    expect(hasHeadroom(null, 2 * GB)).toBe(true);
  });

  it("passes when free >= needed (inclusive)", () => {
    expect(hasHeadroom(3 * GB, 2 * GB)).toBe(true);
    expect(hasHeadroom(2 * GB, 2 * GB)).toBe(true);
  });

  it("blocks when free < needed", () => {
    expect(hasHeadroom(1 * GB, 2 * GB)).toBe(false);
    expect(hasHeadroom(0, 2 * GB)).toBe(false);
    // the incident: 122 MB free against a 2 GB reserve
    expect(hasHeadroom(122 * 1024 ** 2, 2 * GB)).toBe(false);
  });
});
