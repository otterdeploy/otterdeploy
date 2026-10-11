/**
 * `server.list` resolves the control plane's address to the install's public
 * IP, the same address `organization.checkBaseDomainDns` keeps for
 * installation admins. Every organization lists the control plane, so this
 * pins who gets it here too, through the real procedure and middleware chain.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
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

const { listServers } = vi.hoisted(() => ({ listServers: vi.fn() }));

vi.mock("../handlers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../handlers")>()),
  listServers,
}));

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: vi.fn(async () => ({ success: true })) } },
}));

const { serverRouter } = await import("../index");

function base(activeOrganizationId: OrganizationId) {
  return {
    session: null,
    apiKey: null,
    apiKeyRateLimited: null,
    activeOrganizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/servers" }),
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

async function listFor(context: Context): Promise<unknown> {
  listServers.mockClear();
  const client = createProcedureClient(serverRouter.list, { context });
  await client(undefined);
  return listServers.mock.calls[0]?.[1];
}

beforeEach(() => {
  listServers.mockResolvedValue([]);
});

describe("server.list: who may see the install's public IP", () => {
  test("an installation admin", async () => {
    expect(await listFor(sessionContext(true))).toEqual({ revealInstallAddress: true });
  });

  test("not a workspace member or owner without install admin", async () => {
    expect(await listFor(sessionContext(false))).toEqual({ revealInstallAddress: false });
  });

  test("not an API key, even a full-access one", async () => {
    expect(await listFor(apiKeyContext())).toEqual({ revealInstallAddress: false });
  });
});
