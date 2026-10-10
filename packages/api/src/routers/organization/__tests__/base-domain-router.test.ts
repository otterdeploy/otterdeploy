/**
 * The server IP is sensitive: `organization.checkBaseDomainDns` may reveal it
 * to an installation admin only. The handler redacts on a flag; this pins who
 * gets the flag, through the real procedure and middleware chain.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

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

const orgId = idSchema.organization.parse("org_a");

const { checkOrganizationBaseDomainDns } = vi.hoisted(() => ({
  checkOrganizationBaseDomainDns: vi.fn(),
}));

vi.mock("../base-domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../base-domain")>()),
  checkOrganizationBaseDomainDns,
}));

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: vi.fn(async () => ({ success: true })) } },
}));

const { baseDomainRouter } = await import("../base-domain-router");

const view = {
  baseDomain: null,
  serverIp: null,
  serverIpHidden: true,
  publishing: {
    source: "sslip-fallback",
    suffix: "sslip.io",
    onServerIp: true,
    certificate: "self-signed",
  },
  zone: null,
  provider: "unknown",
  records: [],
  wildcard: null,
  apex: null,
  txt: null,
};

function base(activeOrganizationId: OrganizationId) {
  return {
    session: null,
    apiKey: null,
    apiKeyRateLimited: null,
    activeOrganizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/organization" }),
    broadcast: vi.fn(),
  };
}

function sessionContext(isInstallAdmin: boolean): Context {
  return {
    ...base(orgId),
    actor: {
      kind: "session",
      headers: new Headers(),
      user: { id: "user_1", email: "u@acme.test", isInstallAdmin, twoFactorEnabled: true },
      session: { activeOrganizationId: orgId },
    },
  };
}

function apiKeyContext(): Context {
  return {
    ...base(orgId),
    actor: { kind: "api-key", id: "key_1", permissions: null, organizationId: orgId },
  };
}

async function revealFor(context: Context): Promise<unknown> {
  checkOrganizationBaseDomainDns.mockClear();
  const client = createProcedureClient(baseDomainRouter.checkBaseDomainDns, { context });
  await client({ organizationId: orgId });
  return checkOrganizationBaseDomainDns.mock.calls[0]?.[1];
}

beforeEach(() => {
  checkOrganizationBaseDomainDns.mockResolvedValue(Result.ok(view));
});

describe("organization.checkBaseDomainDns: who may see the server IP", () => {
  test("an installation admin", async () => {
    expect(await revealFor(sessionContext(true))).toEqual({ revealServerIp: true });
  });

  test("not a workspace member or owner without install admin", async () => {
    expect(await revealFor(sessionContext(false))).toEqual({ revealServerIp: false });
  });

  test("not an API key, even a full-access one", async () => {
    expect(await revealFor(apiKeyContext())).toEqual({ revealServerIp: false });
  });
});
