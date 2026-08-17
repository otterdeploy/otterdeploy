/**
 * od-5j8.8: end-to-end hostile-path coverage for the git router's
 * gitRepoId-scoped endpoints (getRepo, inspectRepo, listBranches, inspectEnv).
 *
 * Drives the real oRPC procedures (via `createProcedureClient`) with an org-A
 * actor and org-B's `gitRepoId`, asserting NOT_FOUND, never a data leak,
 * never a 500, and that the expensive/network-calling inspect functions are
 * never even reached once the tenant guard rejects the id.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { createProcedureClient, ORPCError } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
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

const orgA = idSchema.organization.parse("org_a");
const orgB = idSchema.organization.parse("org_b");
const victimRepoId = idSchema.gitRepo.parse("gitr_victim");

// getRepoForOrg is exercised directly (with real db-shaped mocks) in
// repo-scope.test.ts; here we only need it to behave like "org B's private
// repo" so the router-level test proves the HANDLERS call it and honor a
// miss, not re-prove the query's own join logic.
const getRepoForOrg = vi.fn<typeof import("../queries").getRepoForOrg>(async () => undefined);

vi.mock("../queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../queries")>();
  return { ...actual, getRepoForOrg };
});

const inspectRepoTree = vi.fn();
const listRepoBranches = vi.fn();
const inspectEnvFiles = vi.fn();
vi.mock("../inspect", () => ({ inspectRepoTree, listRepoBranches, inspectEnvFiles }));

const { gitRouter } = await import("../index");

// Full RequestLogger surface as inert spies: these tests only exercise the
// tenant-scope guard, which at most calls `log.set`.
function stubLogger(): RequestLogger {
  return {
    set: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    emit: vi.fn(() => null),
    getContext: vi.fn(() => ({})),
  };
}

function sessionContext(activeOrganizationId: OrganizationId): Context {
  return {
    actor: {
      kind: "session",
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
    log: stubLogger(),
    broadcast: vi.fn(),
  };
}

describe("git router tenant scope (od-5j8.8)", () => {
  test("getRepo: org B's gitRepoId under an org-A actor ⇒ NOT_FOUND, not a leak", async () => {
    const client = createProcedureClient(gitRouter.getRepo, { context: sessionContext(orgA) });

    await expect(client({ gitRepoId: victimRepoId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getRepoForOrg).toHaveBeenCalledWith({
      gitRepoId: victimRepoId,
      organizationId: orgA,
    });
  });

  test("inspectRepo: rejects before ever calling the (network-calling) tree inspector", async () => {
    const client = createProcedureClient(gitRouter.inspectRepo, {
      context: sessionContext(orgA),
    });

    await expect(client({ gitRepoId: victimRepoId, path: "" })).rejects.toBeInstanceOf(ORPCError);
    expect(inspectRepoTree).not.toHaveBeenCalled();
  });

  test("listBranches: rejects before ever calling GitHub", async () => {
    const client = createProcedureClient(gitRouter.listBranches, {
      context: sessionContext(orgA),
    });

    await expect(client({ gitRepoId: victimRepoId })).rejects.toBeInstanceOf(ORPCError);
    expect(listRepoBranches).not.toHaveBeenCalled();
  });

  test("inspectEnv: rejects before ever calling GitHub", async () => {
    const client = createProcedureClient(gitRouter.inspectEnv, { context: sessionContext(orgA) });

    await expect(client({ gitRepoId: victimRepoId, path: "" })).rejects.toBeInstanceOf(ORPCError);
    expect(inspectEnvFiles).not.toHaveBeenCalled();
  });

  test("org-B's OWN actor can still reach its own repo (guard isn't overzealous)", async () => {
    getRepoForOrg.mockResolvedValueOnce({
      id: victimRepoId,
      fullName: "acme/private-app",
      defaultBranch: "main",
      isPrivate: true,
      cloneUrl: "https://github.com/acme/private-app.git",
      // Public-repo shape (no installation): getRepoForOrg is mocked, so the
      // handler only reads fullName/defaultBranch off this row.
      installationId: null,
      providerOrganizationId: null,
    });
    const client = createProcedureClient(gitRouter.getRepo, { context: sessionContext(orgB) });

    const result = await client({ gitRepoId: victimRepoId });
    expect(result).toEqual({ fullName: "acme/private-app", defaultBranch: "main" });
  });
});
