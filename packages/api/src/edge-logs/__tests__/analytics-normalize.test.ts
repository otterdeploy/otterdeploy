import { describe, expect, test } from "vite-plus/test";

import {
  dayKey,
  epochMinute,
  latencyBucketIndex,
  normalizePath,
  normalizeReferrer,
  PATH_KEY_MAX_LENGTH,
} from "../analytics-normalize";

describe("normalizePath", () => {
  test("strips query strings and fragments", () => {
    expect(normalizePath("/search?q=secret+token")).toBe("/search");
    expect(normalizePath("/docs#section")).toBe("/docs");
    expect(normalizePath("/a?x=1#y")).toBe("/a");
  });

  test("collapses id-ish segments", () => {
    expect(normalizePath("/orders/12345")).toBe("/orders/:id");
    expect(normalizePath("/u/550e8400-e29b-41d4-a716-446655440000/settings")).toBe(
      "/u/:id/settings",
    );
    expect(normalizePath("/commits/deadbeefcafe")).toBe("/commits/:id");
  });

  test("keeps ordinary word segments", () => {
    expect(normalizePath("/api/v1/users")).toBe("/api/v1/users");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });

  test("short hex words survive, long hex collapses", () => {
    // "cafe" (4 hex chars) is a word; 8+ reads as an id.
    expect(normalizePath("/cafe")).toBe("/cafe");
    expect(normalizePath("/cafebabe")).toBe("/:id");
  });

  test("caps the key length", () => {
    // "z" so the long segment isn't all-hex (an all-"a" one collapses to :id).
    const long = `/${"z".repeat(300)}`;
    expect(normalizePath(long).length).toBe(PATH_KEY_MAX_LENGTH);
  });
});

describe("normalizeReferrer", () => {
  test("reduces to a bare lowercase host", () => {
    expect(normalizeReferrer("https://News.Ycombinator.com/item?id=1", "app.example.com")).toBe(
      "news.ycombinator.com",
    );
  });

  test("strips www, port, and credentials", () => {
    expect(normalizeReferrer("https://www.google.com/search", "app.example.com")).toBe(
      "google.com",
    );
    expect(normalizeReferrer("http://evil@google.com:8080/x", "app.example.com")).toBe(
      "google.com",
    );
  });

  test("drops empties, placeholders, and self-referrals", () => {
    expect(normalizeReferrer("", "app.example.com")).toBeNull();
    expect(normalizeReferrer("-", "app.example.com")).toBeNull();
    expect(normalizeReferrer("https://app.example.com/page", "app.example.com")).toBeNull();
    expect(normalizeReferrer("https://www.app.example.com/page", "app.example.com")).toBeNull();
  });
});

describe("time keys", () => {
  test("dayKey is zero-padded UTC", () => {
    expect(dayKey(Date.UTC(2026, 0, 5))).toBe("20260105");
    expect(dayKey(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe("20261231");
  });

  test("epochMinute floors to the minute", () => {
    expect(epochMinute(60_000)).toBe(1);
    expect(epochMinute(119_999)).toBe(1);
    expect(epochMinute(120_000)).toBe(2);
  });
});

describe("latencyBucketIndex", () => {
  test("bounds are inclusive upper edges", () => {
    expect(latencyBucketIndex(0)).toBe(0);
    expect(latencyBucketIndex(1)).toBe(0);
    expect(latencyBucketIndex(2)).toBe(1);
    expect(latencyBucketIndex(100)).toBe(6);
    expect(latencyBucketIndex(5000)).toBe(11);
  });

  test("past the last bound lands in overflow", () => {
    expect(latencyBucketIndex(5001)).toBe(12);
    expect(latencyBucketIndex(60_000)).toBe(12);
  });
});
