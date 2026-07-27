/**
 * od-5j8.8 — hostile-path coverage for the organization-settings tenant
 * boundary.
 *
 * Before this fix, every procedure in this router (`settings`,
 * `setBaseDomain`, `verifyBaseDomain`, `setCloudflareConfig`,
 * `autoConfigureBaseDomain`, `listMembers`, `removeMember`,
 * `updateMemberRole`, `listInvitations`, `cancelInvitation`) read
 * `input.organizationId` — a client-supplied REST path param — and used it
 * directly for the DB/better-auth call. The RBAC middleware
 * (`requirePermission`) only ever validated the CALLER's own active-org
 * permission, never that `input.organizationId` matched it. Net effect: any
 * org owner/admin could read or mutate another tenant's base domain,
 * Cloudflare token/zone, or member list just by editing the id in the
 * request body/URL.
 *
 * These tests drive the real oRPC procedures end-to-end (via
 * `createProcedureClient`, with a hand-built `Context` standing in for a
 * real session) and prove that a caller whose ACTIVE org is org A, but whose
 * INPUT claims org B, only ever touches org A's data — never org B's, and
 * never a leak/500 in between.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient } from "@orpc/server";
import { Result } from "better-result";
import { describe, expect, test, vi } from "vite-plus/test";

import type { Context } from "../../../context";

// oxlint-disable-next-line node/no-process-env -- test env setup boundary: satisfy required vars so the module graph (db/auth/env) loads.
process.env.DATABASE_URL ??= "postgres://test/test";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.REDIS_URL ??= "redis://localhost:6379";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.CORS_ORIGIN ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.RESEND_API_KEY ??= "test-resend-key";

const orgA = "org_a" as OrganizationId;
const orgB = "org_b" as OrganizationId;

// ── In-memory "two tenants" fixture ─────────────────────────────────────
// Keyed by whichever organizationId the router actually calls the handler
// with — this is what makes the assertions meaningful: if the router ever
// regresses to trusting `input.organizationId` again, these mocks return
// ORG B's data for a call the test drives with an org-A actor, and the
// test fails.
const settingsByOrg: Record<string, { id: string; baseDomain: string | null }> = {
  [orgA]: { id: orgA, baseDomain: "org-a.example.com" },
  [orgB]: { id: orgB, baseDomain: "org-b.example.com" },
};

const getOrganizationSettings = vi.fn(async (organizationId: string) => {
  const row = settingsByOrg[organizationId];
  return row
    ? Result.ok({
        ...row,
        name: "n",
        slug: "s",
        baseDomainVerifiedAt: null,
        baseDomainVerifyToken: null,
        cloudflareZoneId: null,
        cloudflareTokenConfigured: false,
      })
    : Result.err(new Error("not found"));
});

const updateOrganizationBaseDomain = vi.fn(
  async (input: { organizationId: string; baseDomain: string }) => {
    const row = settingsByOrg[input.organizationId];
    if (!row) return Result.err(new Error("not found"));
    row.baseDomain = input.baseDomain;
    return Result.ok({
      ...row,
      name: "n",
      slug: "s",
      baseDomainVerifiedAt: null,
      baseDomainVerifyToken: null,
      cloudflareZoneId: null,
      cloudflareTokenConfigured: false,
    });
  },
);

vi.mock("../handlers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handlers")>();
  return {
    ...actual,
    getOrganizationSettings,
    updateOrganizationBaseDomain,
  };
});

// RBAC is covered elsewhere (authz/__tests__/capability.test.ts) — always
// grant it here so these tests isolate the tenant-scope question.
vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: vi.fn(async () => ({ success: true })) } },
}));

const { organizationRouter } = await import("../index");

function sessionContext(activeOrganizationId: string) {
  return {
    actor: {
      kind: "session" as const,
      headers: new Headers(),
      user: {
        id: "user_1",
        email: "attacker@org-a.test",
        isInstallAdmin: false,
        twoFactorEnabled: true,
      },
      session: { activeOrganizationId },
    },
    session: null,
    apiKey: null,
    activeOrganizationId,
    headers: new Headers(),
    log: { set: vi.fn(), audit: undefined },
    broadcast: vi.fn(),
    // Deliberately partial: these tests only exercise the tenant-scope guard,
    // so the context carries just the fields those code paths read.
  } as unknown as Context;
}

describe("organization router tenant scope (od-5j8.8)", () => {
  test("settings: org-A actor claiming org B in input still only ever sees org A's data", async () => {
    const client = createProcedureClient(organizationRouter.settings, {
      context: sessionContext(orgA),
    });

    const result = await client({ organizationId: orgB });

    expect(result.baseDomain).toBe("org-a.example.com");
    expect(getOrganizationSettings).toHaveBeenCalledWith(orgA);
    expect(getOrganizationSettings).not.toHaveBeenCalledWith(orgB);
  });

  test("setBaseDomain: org-A actor claiming org B in input mutates org A, never org B", async () => {
    const client = createProcedureClient(organizationRouter.setBaseDomain, {
      context: sessionContext(orgA),
    });

    const result = await client({ organizationId: orgB, baseDomain: "evil-takeover.example.com" });

    expect(result.baseDomain).toBe("evil-takeover.example.com");
    expect(updateOrganizationBaseDomain).toHaveBeenCalledWith({
      organizationId: orgA,
      baseDomain: "evil-takeover.example.com",
    });
    // Org B's row is untouched by the attacker's request.
    expect(settingsByOrg[orgB]?.baseDomain).toBe("org-b.example.com");
  });
});
