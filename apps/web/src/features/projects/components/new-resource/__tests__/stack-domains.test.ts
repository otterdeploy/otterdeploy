import { describe, expect, it } from "vite-plus/test";

import { deriveStackDomain } from "../stack-domains";

describe("deriveStackDomain", () => {
  it("the front door is the base, unchanged", () => {
    expect(deriveStackDomain("acme.example.com", "dashboard", true)).toBe("acme.example.com");
  });

  it("derives FLAT siblings, never a deeper label", () => {
    // The whole point: `status-page.acme.example.com` would sit a level below
    // the stack, and `*.example.com` does not match it.
    expect(deriveStackDomain("acme.example.com", "status-page", false)).toBe(
      "acme-status-page.example.com",
    );
    expect(deriveStackDomain("acme.example.com", "status-page", false).split(".")).toHaveLength(3);
  });

  it("leaves the zone alone however deep it is", () => {
    expect(deriveStackDomain("shared.dr34mw0rk5.com", "status-page", false)).toBe(
      "shared-status-page.dr34mw0rk5.com",
    );
    expect(deriveStackDomain("a.b.c.d.example.co.uk", "api", false)).toBe(
      "a-api.b.c.d.example.co.uk",
    );
  });

  it("does not stutter when the base already names the service", () => {
    expect(deriveStackDomain("status-page.example.com", "status-page", false)).toBe(
      "status-page.example.com",
    );
    expect(deriveStackDomain("acme-status-page.example.com", "status-page", false)).toBe(
      "acme-status-page.example.com",
    );
  });

  it("handles a single-label host (local dev)", () => {
    expect(deriveStackDomain("acme", "status-page", false)).toBe("acme-status-page");
  });

  it("derives nothing from an empty base: the server still generates one", () => {
    expect(deriveStackDomain("", "status-page", false)).toBe("");
    expect(deriveStackDomain("   ", "dashboard", true)).toBe("");
  });
});
