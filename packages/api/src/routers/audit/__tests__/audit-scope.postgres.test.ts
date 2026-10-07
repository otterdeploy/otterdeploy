/**
 * An organization's audit reads never surface another tenant's rows,
 * and rows with no organization reach only an installation administrator.
 *
 * A NULL-organization row is a failed sign-in against an address with no
 * account (the typed email, the caller's IP and user agent) or an auth/org-gate
 * denial written before a tenant resolved. All three read paths (`feed`, the
 * legacy `list`, and `distinct`) share one scope. Drives the real procedures,
 * middleware included, against a migrated Postgres: the scope is a predicate,
 * so a mocked query would only restate it.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";
import { createRequestLogger } from "evlog";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../../context";

import { seedOrganization, uniq } from "../../../__tests__/postgres-seed";

// The synthetic session user below is a member of the organization it names:
// the org-scoped guard's membership lookup is not under test here.
vi.mock("../../../authz/org-member", () => ({ isOrgMember: vi.fn(async () => true) }));

const { auditRouter } = await import("../index");

function sessionContext(organizationId: OrganizationId, isInstallAdmin: boolean): Context {
  const actor = {
    kind: "session" as const,
    headers: new Headers(),
    user: {
      id: `usr_${uniq()}`,
      email: "member@org-a.test",
      isInstallAdmin,
      twoFactorEnabled: true,
    },
    session: { activeOrganizationId: organizationId },
  };
  return {
    actor,
    session: actor,
    apiKey: null,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/audit" }),
    broadcast: vi.fn(),
  };
}

/** A full-access organization key: org-wide, but never install authority. */
function apiKeyContext(organizationId: OrganizationId): Context {
  const actor = {
    kind: "api-key" as const,
    id: `key_${uniq()}`,
    permissions: null,
    organizationId,
  };
  return {
    actor,
    session: null,
    apiKey: actor,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/audit" }),
    broadcast: vi.fn(),
  };
}

// Every row this file writes carries `token` in its action, so the reads can be
// narrowed to them in a database other files share.
const token = `scope${uniq()}`;
const actions = {
  orgA: `${token}.org-a.project.create`,
  orgB: `${token}.org-b.project.create`,
  unattributed: `${token}.auth.sign-in`,
};
const strangerEmail = `stranger-${token}@typo.test`;
const strangerIp = "203.0.113.77";

let orgA: OrganizationId;
let orgB: OrganizationId;

beforeAll(async () => {
  orgA = await seedOrganization("audit-a");
  orgB = await seedOrganization("audit-b");
  await db.insert(auditLog).values([
    {
      organizationId: orgA,
      action: actions.orgA,
      actorType: "user",
      actorId: `usr_a_${token}`,
      actorEmail: `owner-${token}@org-a.test`,
      outcome: "success",
    },
    {
      organizationId: orgB,
      action: actions.orgB,
      actorType: "user",
      actorId: `usr_b_${token}`,
      actorEmail: `owner-${token}@org-b.test`,
      outcome: "success",
    },
    // A failed sign-in against an address with no account: no tenant resolves.
    {
      organizationId: null,
      action: actions.unattributed,
      actorType: "user",
      actorId: `anonymous_${token}`,
      actorEmail: strangerEmail,
      outcome: "failure",
      reason: "INVALID_EMAIL_OR_PASSWORD",
      ip: strangerIp,
      userAgent: "curl/8.7.1",
    },
  ]);
});

async function feedActions(context: Context): Promise<string[]> {
  const client = createProcedureClient(auditRouter.feed, { context });
  const page = await client({ filters: { q: token }, size: 50, includeFacets: false });
  return page.items.map((r) => r.action).sort();
}

async function listActions(context: Context): Promise<{ actions: string[]; failed: number }> {
  const client = createProcedureClient(auditRouter.list, { context });
  const page = await client({ q: token, limit: 50, offset: 0 });
  return { actions: page.items.map((r) => r.action).sort(), failed: page.counts.failed };
}

async function distinctValues(
  context: Context,
): Promise<{ actions: string[]; actorEmails: (string | null)[] }> {
  const client = createProcedureClient(auditRouter.distinct, { context });
  const out = await client({});
  return {
    actions: out.actions.filter((a) => a.startsWith(token)).sort(),
    actorEmails: out.actors.map((a) => a.email),
  };
}

describe("audit reads are scoped to the caller's org; null-org rows need install authority", () => {
  it("a member of org A sees only org A's rows in the feed", async () => {
    expect(await feedActions(sessionContext(orgA, false))).toEqual([actions.orgA]);
  });

  it("a member of org A sees only org A's rows in list, and the failed count excludes the null-org sign-in", async () => {
    expect(await listActions(sessionContext(orgA, false))).toEqual({
      actions: [actions.orgA],
      failed: 0,
    });
  });

  it("a member of org A gets no null-org or org B values from distinct", async () => {
    const out = await distinctValues(sessionContext(orgA, false));
    expect(out.actions).toEqual([actions.orgA]);
    expect(out.actorEmails).not.toContain(strangerEmail);
    expect(out.actorEmails).not.toContain(`owner-${token}@org-b.test`);
  });

  it("an org API key, even a full-access one, does not reach null-org rows", async () => {
    const context = apiKeyContext(orgA);
    expect(await feedActions(context)).toEqual([actions.orgA]);
    expect((await listActions(context)).actions).toEqual([actions.orgA]);
    expect((await distinctValues(context)).actions).toEqual([actions.orgA]);
  });

  it("an install admin sees null-org rows beside their org's, and still never org B's", async () => {
    const context = sessionContext(orgA, true);
    const expected = [actions.orgA, actions.unattributed].sort();
    expect(await feedActions(context)).toEqual(expected);
    expect(await listActions(context)).toEqual({ actions: expected, failed: 1 });
    const out = await distinctValues(context);
    expect(out.actions).toEqual(expected);
    expect(out.actorEmails).toContain(strangerEmail);
    expect(out.actorEmails).not.toContain(`owner-${token}@org-b.test`);
  });

  it("the null-org row an install admin reads is the failed sign-in, IP and all", async () => {
    const client = createProcedureClient(auditRouter.feed, {
      context: sessionContext(orgA, true),
    });
    const page = await client({ filters: { q: actions.unattributed }, includeFacets: false });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      action: actions.unattributed,
      actor: strangerEmail,
      ip: strangerIp,
      outcome: "failure",
    });
  });
});
