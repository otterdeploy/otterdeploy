import { describe, expect, it } from "vite-plus/test";

import { scopeHostCount } from "../analytics-query-shared";

describe("scopeHostCount", () => {
  it("counts the install's live routes on a quiet install-wide window", () => {
    // Three routes, no request in the window: this is a quiet window, not an
    // install with no public domains.
    expect(scopeHostCount(null, ["a.example.com", "b.example.com", "c.example.com"], [])).toBe(3);
  });

  it("adds a host that sent traffic but has no route any more, once", () => {
    expect(scopeHostCount(null, ["a.example.com"], ["a.example.com", "gone.example.com"])).toBe(2);
  });

  it("is zero install-wide only when there is no route and no traffic", () => {
    expect(scopeHostCount(null, [], [])).toBe(0);
  });

  it("uses a scoped view's own domain list", () => {
    expect(scopeHostCount(["a.example.com"], ["a.example.com", "b.example.com"], [])).toBe(1);
  });
});
