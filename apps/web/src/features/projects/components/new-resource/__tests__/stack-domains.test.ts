import { describe, expect, it } from "vite-plus/test";

import { deriveStackDomain, rederiveDomains } from "../stack-domains";

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

describe("rederiveDomains", () => {
  const rows = [
    { key: "dashboard:3000", domain: "acme.example.com", custom: false },
    { key: "status-page:3000", domain: "acme-status-page.example.com", custom: false },
  ];

  it("the front door takes the new base and the rest follow it", () => {
    expect(rederiveDomains(rows, "moved.example.com")).toEqual([
      { key: "dashboard:3000", domain: "moved.example.com", custom: false },
      { key: "status-page:3000", domain: "moved-status-page.example.com", custom: false },
    ]);
  });

  it("leaves a pinned row alone", () => {
    const pinned = [rows[0], { ...rows[1], domain: "status.acme.com", custom: true }];
    expect(rederiveDomains(pinned, "moved.example.com")[1]).toEqual({
      key: "status-page:3000",
      domain: "status.acme.com",
      custom: true,
    });
  });

  it("an empty base clears the derived rows, so the server generates them", () => {
    expect(rederiveDomains(rows, "").map((r) => r.domain)).toEqual(["", ""]);
  });
});

describe("rederiveDomains: two published ports on one container", () => {
  it("adds the port to the label, so two routes are not one hostname", () => {
    const rows = [
      { key: "dashboard:3000", domain: "", custom: false },
      { key: "libsql:8080", domain: "", custom: false },
      { key: "libsql:5001", domain: "", custom: false },
    ];
    expect(rederiveDomains(rows, "acme.example.com").map((r) => r.domain)).toEqual([
      "acme.example.com",
      "acme-libsql-8080.example.com",
      "acme-libsql-5001.example.com",
    ]);
  });

  it("leaves a single-port service unsuffixed", () => {
    const rows = [
      { key: "dashboard:3000", domain: "", custom: false },
      { key: "libsql:8080", domain: "", custom: false },
    ];
    expect(rederiveDomains(rows, "acme.example.com")[1]?.domain).toBe("acme-libsql.example.com");
  });
});
