import { describe, expect, it } from "vite-plus/test";

import { analyticsBreakdownInput, analyticsQueryInput } from "../contract";

const DAY_MS = 24 * 60 * 60 * 1000;
const to = Date.UTC(2026, 7, 20, 12, 0, 0);

function reasons(schema: typeof analyticsQueryInput, input: Record<string, unknown>): string {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected the input to be rejected");
  return result.error.issues.map((i) => i.message).join(" ");
}

describe("analytics query input", () => {
  it("defaults so an empty query is a valid 7d/UTC one", () => {
    const result = analyticsQueryInput.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.range).toBe("7d");
      expect(result.data.tz).toBe("UTC");
      expect(result.data.filters).toEqual([]);
      expect(result.data.compare).toBe(false);
    }
  });

  it("accepts every range preset", () => {
    for (const range of ["today", "yesterday", "24h", "7d", "30d", "90d", "6mo", "12mo", "all"]) {
      expect(analyticsQueryInput.safeParse({ range }).success).toBe(true);
    }
  });

  it("rejects a half-specified custom window in either direction", () => {
    expect(reasons(analyticsQueryInput, { from: to - DAY_MS })).toContain("together");
    expect(reasons(analyticsQueryInput, { to })).toContain("together");
  });

  it("rejects a backwards or empty custom window", () => {
    expect(reasons(analyticsQueryInput, { from: to, to: to - DAY_MS })).toContain("before");
    expect(reasons(analyticsQueryInput, { from: to, to })).toContain("before");
  });

  it("caps a custom window at 400 days", () => {
    expect(analyticsQueryInput.safeParse({ from: to - 400 * DAY_MS, to }).success).toBe(true);
    expect(reasons(analyticsQueryInput, { from: to - 400 * DAY_MS - 1, to })).toContain("400");
  });

  it("caps filters at 20 and validates their shape", () => {
    const filter = { dim: "path", op: "is", value: "/x" };
    expect(
      analyticsQueryInput.safeParse({ filters: Array.from({ length: 20 }, () => filter) }).success,
    ).toBe(true);
    expect(
      analyticsQueryInput.safeParse({ filters: Array.from({ length: 21 }, () => filter) }).success,
    ).toBe(false);
    expect(
      analyticsQueryInput.safeParse({ filters: [{ dim: "nope", op: "is", value: "x" }] }).success,
    ).toBe(false);
    expect(
      analyticsQueryInput.safeParse({ filters: [{ dim: "path", op: "matches", value: "x" }] })
        .success,
    ).toBe(false);
    expect(
      analyticsQueryInput.safeParse({ filters: [{ dim: "path", op: "is", value: "" }] }).success,
    ).toBe(false);
  });

  it("rejects a malformed projectId", () => {
    expect(analyticsQueryInput.safeParse({ projectId: "not-a-project" }).success).toBe(false);
  });
});

describe("analytics breakdown input", () => {
  it("accepts every documented dimension, including goal", () => {
    for (const dimension of ["path", "entryPath", "channel", "screen", "event", "goal"]) {
      expect(analyticsBreakdownInput.safeParse({ dimension }).success).toBe(true);
    }
  });

  it("rejects an unknown dimension and requires one", () => {
    expect(analyticsBreakdownInput.safeParse({ dimension: "hostname" }).success).toBe(false);
    expect(analyticsBreakdownInput.safeParse({}).success).toBe(false);
  });

  it("defaults limit/offset and caps limit at 500", () => {
    const result = analyticsBreakdownInput.safeParse({ dimension: "path" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(0);
    }
    expect(analyticsBreakdownInput.safeParse({ dimension: "path", limit: 500 }).success).toBe(true);
    expect(analyticsBreakdownInput.safeParse({ dimension: "path", limit: 501 }).success).toBe(
      false,
    );
    expect(analyticsBreakdownInput.safeParse({ dimension: "path", offset: -1 }).success).toBe(
      false,
    );
  });

  it("keeps the shared window refinements after extension", () => {
    expect(
      analyticsBreakdownInput.safeParse({ dimension: "path", from: to - DAY_MS }).success,
    ).toBe(false);
  });
});
