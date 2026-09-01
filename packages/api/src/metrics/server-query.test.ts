import { describe, expect, it } from "vite-plus/test";

import { chooseServerBucketSeconds } from "./server-query";

describe("chooseServerBucketSeconds", () => {
  it("never buckets finer than one report", () => {
    expect(chooseServerBucketSeconds(30)).toBe(60);
    expect(chooseServerBucketSeconds(60)).toBe(60);
  });

  it("holds every window to roughly 240 points, in whole minutes", () => {
    // 6 h: 90 s would be exact; rounded up to the next whole minute.
    expect(chooseServerBucketSeconds(360)).toBe(120);
    // 24 h: 1,440 raw reports become 240 six-minute buckets.
    expect(chooseServerBucketSeconds(1440)).toBe(360);
    // 7 d: 10,080 raw reports (past the old 5,000 cap) become 240 buckets.
    expect(chooseServerBucketSeconds(10_080)).toBe(2520);
  });
});
