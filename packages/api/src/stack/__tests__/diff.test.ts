import { describe, expect, it } from "vite-plus/test";

import { unifiedDiff } from "../render/diff";

describe("stack/render/unifiedDiff", () => {
  it("returns empty when both inputs match", () => {
    expect(unifiedDiff("hello\nworld\n", "hello\nworld\n")).toBe("");
  });

  it("emits add/remove markers for changed lines", () => {
    const diff = unifiedDiff("a\nb\nc", "a\nB\nc");
    expect(diff).toContain("--- saved");
    expect(diff).toContain("+++ rendered");
    expect(diff).toContain("-b");
    expect(diff).toContain("+B");
  });

  it("handles previous file being empty (project never saved a stackFile)", () => {
    const diff = unifiedDiff("", "x\ny\n");
    expect(diff).toContain("+x");
    expect(diff).toContain("+y");
  });
});
