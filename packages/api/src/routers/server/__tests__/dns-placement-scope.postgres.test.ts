/**
 * `server.dnsPlacement` reports on the caller's organization's routes only.
 *
 * It used to read every enabled route in the install, so any member of any
 * organization was shown every other tenant's domains (and the addresses they
 * resolve to), and each call resolved one name per route in the whole install
 * over public DNS. Drives the real procedure, middleware included, for a
 * member of the organization; only the resolver is stubbed, so the test never
 * reaches the network.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { member, user } from "@otterdeploy/db/schema/auth";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../../context";

import { seedOrganization, seedProject, seedService, uniq } from "../../../__tests__/postgres-seed";

const resolved = vi.hoisted(() => {
  const names: string[] = [];
  return { names };
});

vi.mock("../../../lib/dns-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/dns-resolver")>()),
  resolveAddressesRobust: async (name: string) => {
    resolved.names.push(name);
    return Result.ok(["192.0.2.10"]);
  },
}));

const { serverRouter } = await import("../index");

/** A signed-in member of a fresh organization, as the org-scoped guard sees it. */
async function seedMemberContext(): Promise<{ organizationId: OrganizationId; context: Context }> {
  const organizationId = await seedOrganization("dns");
  const email = `member-${uniq()}@dns-placement.test`;
  const [created] = await db
    .insert(user)
    .values({ name: "member", email })
    .returning({ id: user.id });
  if (!created) throw new Error("user insert returned no row");
  await db.insert(member).values({ organizationId, userId: created.id, role: "member" });
  const actor = {
    kind: "session" as const,
    headers: new Headers(),
    user: { id: created.id, email, isInstallAdmin: false, twoFactorEnabled: true },
    session: { activeOrganizationId: organizationId },
  };
  return {
    organizationId,
    context: {
      actor,
      session: actor,
      apiKey: null,
      activeOrganizationId: organizationId,
      headers: new Headers(),
      log: createRequestLogger({ method: "TEST", path: "/rpc/server.dnsPlacement" }),
      broadcast: vi.fn(),
    },
  };
}

/** An enabled HTTP route to a fresh service in a fresh project of the org. */
async function seedRoute(organizationId: OrganizationId): Promise<string> {
  const project = await seedProject(organizationId);
  const service = await seedService({
    projectId: project.projectId,
    environmentId: project.mainEnvironmentId,
    name: `web-${uniq()}`,
  });
  const domain = `dns-${uniq()}.placement-scope.test`;
  await db.insert(proxyRoute).values({
    projectId: project.projectId,
    resourceId: service.resourceId,
    type: "http",
    domain,
    upstreamHost: service.host,
    upstreamPort: 80,
    protocol: "http",
    enabled: true,
  });
  return domain;
}

let context: Context;
let ownDomain: string;
let foreignDomain: string;

beforeAll(async () => {
  const caller = await seedMemberContext();
  const other = await seedMemberContext();
  context = caller.context;
  ownDomain = await seedRoute(caller.organizationId);
  foreignDomain = await seedRoute(other.organizationId);
});

describe("server.dnsPlacement is scoped to the caller's organization", () => {
  it("reports the caller's own domain and never another tenant's, nor resolves it", async () => {
    resolved.names.length = 0;
    const client = createProcedureClient(serverRouter.dnsPlacement, { context });

    const report = await client({});

    expect(report.map((r) => r.domain)).toEqual([ownDomain]);
    expect(resolved.names).toEqual([ownDomain]);
    expect(resolved.names).not.toContain(foreignDomain);
  });
});
