/**
 * od-5j8.8 — end-to-end hostile-path coverage for the git router's
 * gitRepoId-scoped endpoints (getRepo, inspectRepo, listBranches, inspectEnv).
 *
 * Drives the real oRPC procedures (via `createProcedureClient`) with an org-A
 * actor and org-B's `gitRepoId`, asserting NOT_FOUND — never a data leak,
 * never a 500 — and that the expensive/network-calling inspect functions are
 * never even reached once the tenant guard rejects the id.
 */
import type { GitRepoId, OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient, ORPCError } from "@orpc/server";
import { describe, expect, test, vi } from "vite-plus/test";

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
const victimRepoId = "gitrepo_victim" as GitRepoId;

// getRepoForOrg is exercised directly (with real db-shaped mocks) in
// repo-scope.test.ts; here we only need it to behave like "org B's private
// repo" so the router-level test proves the HANDLERS call it and honor a
// miss — not re-prove the query's own join logic.
const getRepoForOrg = vi.fn(async () => undefined);

vi.mock("../queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../queries")>();
  return { ...actual, getRepoForOrg };
});

const inspectRepoTree = vi.fn();
const listRepoBranches = vi.fn();
const inspectEnvFiles = vi.fn();
vi.mock("../inspect", () => ({ inspectRepoTree, listRepoBranches, inspectEnvFiles }));

const { gitRouter } = await import("../index");

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const client = createProcedureClient(gitRouter.getRepo, { context: sessionContext(orgB) });

    const result = await client({ gitRepoId: victimRepoId });
    expect(result).toEqual({ fullName: "acme/private-app", defaultBranch: "main" });
  });
});
