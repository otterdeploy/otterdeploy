import { describe, expect, it } from "vite-plus/test";

import { normalizeUrl } from "./config";

describe("normalizeUrl", () => {
  it("adds an https:// scheme to a bare host", () => {
    // The regression: `login --url deploy.acme.com` used to reach better-auth
    // as `deploy.acme.com/api/auth` and fail with "Invalid base URL".
    expect(normalizeUrl("deploy.acme.com")).toBe("https://deploy.acme.com");
  });

  it("preserves an existing scheme and port", () => {
    expect(normalizeUrl("http://otter.local:3000")).toBe("http://otter.local:3000");
    expect(normalizeUrl("https://otter.acme.com")).toBe("https://otter.acme.com");
  });

  it("strips a trailing slash so it composes with /api/auth", () => {
    expect(normalizeUrl("https://otter.acme.com/")).toBe("https://otter.acme.com");
    expect(normalizeUrl("otter.acme.com/")).toBe("https://otter.acme.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeUrl("  deploy.acme.com  ")).toBe("https://deploy.acme.com");
  });

  it("returns null for empty, whitespace, or nullish input", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
  });

  it("returns null for an unparseable URL", () => {
    expect(normalizeUrl("http://")).toBeNull();
  });
});
