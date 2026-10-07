/**
 * Who may save which raw directives on a route.
 *
 * Raw directives are open to every route editor: the feature is constrained,
 * never gated. Two things are decided by the procedure, not the text:
 * `metrics`, which serves the whole install's traffic, needs the server-owned
 * install-admin attribute; and the project-aware reach rules run before
 * anything is written. Drives the real oRPC procedure with a hand-built
 * context; queries and the save are mocked so nothing touches a database,
 * Caddy or DNS.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { DEFAULT_ROUTE_POLICY } from "@otterdeploy/shared/route-policy";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { RouteDirectiveScope } from "../../../caddy/directive-scope";
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
const routeId = idSchema.proxyRoute.parse("rt_a");

const route = {
  id: routeId,
  projectId: idSchema.project.parse("prj_shop"),
  resourceId: null,
  previewId: null,
  type: "http" as const,
  domain: "shop.example.com",
  upstreamHost: "od-shop-web",
  upstreamPort: 3000,
  protocol: "http" as const,
  layer4Alpn: null,
  enabled: true,
  disabledByUser: false,
  exposureScope: "public" as const,
  source: "generated" as const,
  isPrimary: true,
  dnsState: "unknown" as const,
  dnsCheckedAt: null,
  certState: "unknown" as const,
  certError: null,
  certCheckedAt: null,
  usesAcme: false,
  protected: false,
  routePolicy: DEFAULT_ROUTE_POLICY,
  customDirectives: null,
  accessPinHash: null,
  domainVerifyToken: null,
  domainVerifiedAt: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
};

const scope: RouteDirectiveScope = {
  own: { bases: new Set(["od-shop-web", "od-shop-api"]), environments: new Set() },
  allowAddresses: [],
  denyAddresses: [],
  denyHosts: [],
  lookup: () => Promise.resolve(["93.184.216.34"]),
  lookupTimeoutMs: 50,
};

const saveRouteCustomDirectives = vi.fn(async () => ({ route, applied: true, error: null }));

vi.mock("../queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../queries")>();
  return { ...actual, getRouteInOrg: vi.fn(async () => route) };
});

vi.mock("../proxy-route-upstreams", () => ({
  loadRouteDirectiveScope: vi.fn(async () => scope),
}));

vi.mock("../../../caddy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../caddy")>();
  return { ...actual, saveRouteCustomDirectives };
});

// The caller is a current member of its organization: the org-scoped guard's
// per-request membership lookup is not what these tests exercise.
vi.mock("../../../authz/org-member", () => ({ isOrgMember: vi.fn(async () => true) }));

// Every org permission check passes: route:update is not what decides here.
vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: vi.fn(async () => ({ success: true })) } },
}));

const { proxyRouteRouter } = await import("../router-proxy-routes");

function sessionContext(isInstallAdmin: boolean, organizationId: OrganizationId): Context {
  const actor = {
    kind: "session" as const,
    headers: new Headers(),
    user: { id: "usr_caller", email: "caller@org-a.test", isInstallAdmin, twoFactorEnabled: true },
    session: { activeOrganizationId: organizationId },
  };
  return {
    actor,
    session: actor,
    apiKey: null,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/proxy-route" }),
    broadcast: vi.fn(),
  };
}

function save(isInstallAdmin: boolean, directives: string) {
  const client = createProcedureClient(proxyRouteRouter.setCustomDirectives, {
    context: sessionContext(isInstallAdmin, orgId),
  });
  return client({ routeId, directives });
}

describe("the metrics directive is an installation administrator's call", () => {
  beforeEach(() => saveRouteCustomDirectives.mockClear());

  it("a route editor who is not an install admin cannot add metrics", async () => {
    await expect(save(false, "handle /internal/* {\n\tmetrics\n}")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      message: expect.stringMatching(/metrics directive/),
    });
    expect(saveRouteCustomDirectives).not.toHaveBeenCalled();
  });

  it("an install admin can add metrics", async () => {
    const result = await save(true, "metrics /metrics");
    expect(result.applied).toBe(true);
    expect(saveRouteCustomDirectives).toHaveBeenCalledWith(
      expect.objectContaining({ id: routeId }),
      "metrics /metrics",
      expect.anything(),
    );
  });

  it("everything else stays open to a route editor", async () => {
    const result = await save(
      false,
      'header X-Robots-Tag "noindex"\nreverse_proxy /api/* od-shop-api:8080',
    );
    expect(result.applied).toBe(true);
    expect(saveRouteCustomDirectives).toHaveBeenCalledOnce();
  });
});

describe("the project-aware reach rules run before anything is written", () => {
  beforeEach(() => saveRouteCustomDirectives.mockClear());

  it.each([
    ["another project's service", "reverse_proxy od-other-api:80", /not one of this project's/],
    ["a platform network address", "reverse_proxy 172.18.0.3:6379", /private or internal/],
  ])("%s is refused with the reason and nothing is saved", async (_label, text, reason) => {
    const result = await save(true, text);
    expect(result).toMatchObject({ applied: false, error: expect.stringMatching(reason) });
    expect(saveRouteCustomDirectives).not.toHaveBeenCalled();
  });

  it("clearing the directives skips the reach check and saves", async () => {
    const result = await save(false, "");
    expect(result.applied).toBe(true);
    expect(saveRouteCustomDirectives).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.anything(),
    );
  });
});
