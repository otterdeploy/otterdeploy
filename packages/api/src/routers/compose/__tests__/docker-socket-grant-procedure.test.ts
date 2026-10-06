/**
 * Who may grant a stack the Docker socket.
 *
 * The socket is root on the host and every tenant on it, so the grant is an
 * installation administrator's decision. No organization role reaches it, not
 * even an owner whose every RBAC check passes, and no API key. Drives the real
 * oRPC procedure (its middleware ladder included) with a hand-built context;
 * the query module is mocked so nothing touches a database.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createProcedureClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { idSchema } from "@otterdeploy/shared/id";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
const projectId = idSchema.project.parse("prj_a");
const resourceId = idSchema.resource.parse("res_stack");

const stackRow = {
  resource: { id: resourceId, name: "shell" },
  compose: {
    resourceId,
    source: "inline",
    composeContent: "services: {}",
    stackName: "a-shell",
    services: [],
    exposed: [],
    dockerSocketGrantedAt: null,
  },
};

const setDockerSocketGrant = vi.fn(async () => undefined);
const getComposeRecord = vi.fn<() => Promise<typeof stackRow | null>>(async () => stackRow);

vi.mock("../queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../queries")>();
  return { ...actual, getComposeRecord, setDockerSocketGrant };
});

// Every org permission check passes: the point is that org RBAC alone, the
// most an organization owner has, never reaches this procedure.
vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: vi.fn(async () => ({ success: true })) } },
}));

const { composeRouter } = await import("../index");

function sessionContext(isInstallAdmin: boolean, organizationId: OrganizationId): Context {
  const actor = {
    kind: "session" as const,
    headers: new Headers(),
    user: {
      id: "usr_caller",
      email: "caller@org-a.test",
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
    log: createRequestLogger({ method: "TEST", path: "/compose" }),
    broadcast: vi.fn(),
  };
}

function apiKeyContext(organizationId: OrganizationId): Context {
  const actor = {
    kind: "api-key" as const,
    id: "key_1",
    permissions: { service: ["create", "read", "update", "delete", "deploy"] },
    organizationId,
  };
  return {
    actor,
    session: null,
    apiKey: actor,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/compose" }),
    broadcast: vi.fn(),
  };
}

const input = { projectId, resourceId, granted: true };

describe("compose.setDockerSocketGrant is install-admin only", () => {
  beforeEach(() => {
    setDockerSocketGrant.mockClear();
  });

  it("an organization owner/member cannot grant a stack the docker socket", async () => {
    const client = createProcedureClient(composeRouter.setDockerSocketGrant, {
      context: sessionContext(false, orgId),
    });
    await expect(client(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(setDockerSocketGrant).not.toHaveBeenCalled();
  });

  it("an organization API key cannot grant a stack the docker socket", async () => {
    const client = createProcedureClient(composeRouter.setDockerSocketGrant, {
      context: apiKeyContext(orgId),
    });
    await expect(client(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(setDockerSocketGrant).not.toHaveBeenCalled();
  });

  it("an installation administrator grants it to that one stack, recorded as theirs", async () => {
    const client = createProcedureClient(composeRouter.setDockerSocketGrant, {
      context: sessionContext(true, orgId),
    });
    await client(input);
    expect(setDockerSocketGrant).toHaveBeenCalledWith({
      resourceId,
      granted: true,
      userId: "usr_caller",
    });
  });

  it("granting on a stack that does not exist is NOT_FOUND and records nothing", async () => {
    getComposeRecord.mockResolvedValueOnce(null);
    const client = createProcedureClient(composeRouter.setDockerSocketGrant, {
      context: sessionContext(true, orgId),
    });
    await expect(client(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      message: "Compose resource or project not found",
    });
    expect(setDockerSocketGrant).not.toHaveBeenCalled();
  });
});

/** The same router tree the server mounts, so procedure paths match. */
const router = { compose: composeRouter };

describe("compose.setDockerSocketGrant is reachable on both HTTP channels", () => {
  beforeEach(() => {
    setDockerSocketGrant.mockClear();
  });

  it("an installation administrator grants it over /rpc", async () => {
    const handler = new RPCHandler(router);
    const request = new Request("http://localhost/rpc/compose/setDockerSocketGrant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    });

    const result = await handler.handle(request, {
      prefix: "/rpc",
      context: sessionContext(true, orgId),
    });

    expect(result.matched).toBe(true);
    expect(result.response?.status).toBe(200);
    expect(setDockerSocketGrant).toHaveBeenCalledWith({
      resourceId,
      granted: true,
      userId: "usr_caller",
    });
  });

  it("an installation administrator grants it over the /api/reference OpenAPI mirror", async () => {
    const handler = new OpenAPIHandler(router);
    const request = new Request("http://localhost/api/reference/compose/setDockerSocketGrant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    const result = await handler.handle(request, {
      prefix: "/api/reference",
      context: sessionContext(true, orgId),
    });

    expect(result.matched).toBe(true);
    expect(result.response?.status).toBe(200);
    expect(setDockerSocketGrant).toHaveBeenCalledWith({
      resourceId,
      granted: true,
      userId: "usr_caller",
    });
  });
});
