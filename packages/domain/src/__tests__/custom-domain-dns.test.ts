import { describe, it, expect, vi } from "vitest";

vi.mock("@otterdeploy/db", () => ({
  db: { query: { customDomain: { findFirst: vi.fn(), findMany: vi.fn() } }, insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  eq: vi.fn(),
  and: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("@otterdeploy/db/schema/operations", () => ({
  customDomain: { id: "id", organizationId: "orgId", domain: "domain", resourceId: "resId", verified: "verified", $inferSelect: {} },
}));
vi.mock("@otterdeploy/db/schema/project", () => ({
  resource: { id: "id", $inferSelect: {} },
}));

import { resolveResourceDomain } from "../custom-domain";
import type { DnsVerificationDeps } from "../custom-domain";

// Mock DNS deps for testing
function createMockDnsDeps(
  overrides: Partial<DnsVerificationDeps> = {},
): DnsVerificationDeps {
  return {
    resolveTxt: vi.fn().mockResolvedValue([]),
    resolve4: vi.fn().mockResolvedValue([]),
    resolveCname: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("resolveResourceDomain", () => {
  const resource = { name: "api", id: "res-1" };

  it("returns custom domain when verified", () => {
    const result = resolveResourceDomain(
      resource,
      { slug: "myapp", baseDomain: "myapp.io" },
      { baseDomain: "apps.example.com" },
      [{ domain: "api.custom.com", verified: true }],
    );
    expect(result).toBe("api.custom.com");
  });

  it("falls back to project base domain", () => {
    const result = resolveResourceDomain(
      resource,
      { slug: "myapp", baseDomain: "myapp.io" },
      { baseDomain: "apps.example.com" },
      [],
    );
    expect(result).toBe("api.myapp.io");
  });

  it("falls back to server base domain", () => {
    const result = resolveResourceDomain(
      resource,
      { slug: "myapp", baseDomain: null },
      { baseDomain: "apps.example.com" },
      [],
    );
    expect(result).toBe("api-myapp.apps.example.com");
  });

  it("returns null when no domain available", () => {
    const result = resolveResourceDomain(
      resource,
      { slug: "myapp", baseDomain: null },
      { baseDomain: null },
      [],
    );
    expect(result).toBeNull();
  });

  it("ignores unverified custom domains", () => {
    const result = resolveResourceDomain(
      resource,
      { slug: "myapp", baseDomain: "myapp.io" },
      { baseDomain: "apps.example.com" },
      [{ domain: "api.custom.com", verified: false }],
    );
    expect(result).toBe("api.myapp.io");
  });

  it("uses the first verified custom domain when multiple exist", () => {
    const result = resolveResourceDomain(
      resource,
      { slug: "myapp", baseDomain: "myapp.io" },
      { baseDomain: "apps.example.com" },
      [
        { domain: "api-old.custom.com", verified: true },
        { domain: "api-new.custom.com", verified: true },
      ],
    );
    expect(result).toBe("api-old.custom.com");
  });

  it("skips unverified and picks verified", () => {
    const result = resolveResourceDomain(
      resource,
      { slug: "myapp", baseDomain: "myapp.io" },
      { baseDomain: "apps.example.com" },
      [
        { domain: "api-unverified.custom.com", verified: false },
        { domain: "api-verified.custom.com", verified: true },
      ],
    );
    expect(result).toBe("api-verified.custom.com");
  });
});

// Note: Tests for verifyDomainOwnership, checkDnsTrafficReadiness, verifyDomainFull,
// checkDomainConflict, updateSslStatus, and updateRedirectRules require DB access.
// Those would be integration tests using a test database or DB mocking.
// The DnsVerificationDeps interface supports dependency injection for DNS mocking.
describe("createMockDnsDeps", () => {
  it("creates mock deps with default empty responses", async () => {
    const deps = createMockDnsDeps();
    expect(await deps.resolveTxt("example.com")).toEqual([]);
    expect(await deps.resolve4("example.com")).toEqual([]);
    expect(await deps.resolveCname("example.com")).toEqual([]);
  });

  it("allows overriding individual resolvers", async () => {
    const deps = createMockDnsDeps({
      resolveTxt: vi
        .fn()
        .mockResolvedValue([["my-verification-token"]]),
      resolve4: vi.fn().mockResolvedValue(["1.2.3.4"]),
    });

    const txtRecords = await deps.resolveTxt("_otterstack-verify.example.com");
    expect(txtRecords).toEqual([["my-verification-token"]]);

    const aRecords = await deps.resolve4("example.com");
    expect(aRecords).toEqual(["1.2.3.4"]);

    // CNAME still uses default
    expect(await deps.resolveCname("example.com")).toEqual([]);
  });
});
