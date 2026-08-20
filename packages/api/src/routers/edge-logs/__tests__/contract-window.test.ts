import { describe, expect, it } from "vite-plus/test";

import { edgeLogQueryInput } from "../contract";

/**
 * The custom-window refinements are the only thing standing between the UI's
 * date picker and a query that asks for a window the store cannot answer:
 * a half-specified pair, a backwards pair, or one wider than the 7-day
 * retention. The window math itself is covered in edge-logs/__tests__.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const to = Date.UTC(2026, 7, 20, 12, 0, 0);

function reason(input: Record<string, unknown>): string {
  const result = edgeLogQueryInput.safeParse(input);
  if (result.success) throw new Error("expected the input to be rejected");
  return result.error.issues.map((i) => i.message).join(" ");
}

describe("edgeLogs.query input", () => {
  it("accepts a rolling range with no custom window", () => {
    expect(edgeLogQueryInput.safeParse({ range: "1h" }).success).toBe(true);
  });

  it("defaults the range so an empty query is still a valid one", () => {
    const result = edgeLogQueryInput.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.range).toBe("1h");
  });

  it("accepts a custom window inside the retention period", () => {
    expect(edgeLogQueryInput.safeParse({ from: to - DAY_MS, to }).success).toBe(true);
  });

  it("accepts a window exactly at the 7-day retention boundary", () => {
    expect(edgeLogQueryInput.safeParse({ from: to - 7 * DAY_MS, to }).success).toBe(true);
  });

  it("rejects a half-specified window in either direction", () => {
    expect(reason({ from: to - DAY_MS })).toContain("together");
    expect(reason({ to })).toContain("together");
  });

  it("rejects a backwards window, and an empty one", () => {
    expect(reason({ from: to, to: to - DAY_MS })).toContain("before");
    // from === to would select nothing; the same rule catches it.
    expect(reason({ from: to, to })).toContain("before");
  });

  it("rejects a window wider than the retention period", () => {
    expect(reason({ from: to - 7 * DAY_MS - 1, to })).toContain("7 days");
  });
});
