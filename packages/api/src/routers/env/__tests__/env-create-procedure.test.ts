/**
 * env.create's failures reach the caller as typed contract errors.
 *
 * env-create-project-scope.postgres.test.ts proves `createEnv` refuses a
 * project outside the caller's org with ProjectNotFoundError.
 * This drives the real oRPC procedure, middleware ladder included, and checks
 * the router maps that refusal to NOT_FOUND, and an unexpected database
 * failure to INTERNAL_SERVER_ERROR carrying only the summarised cause. The
 * handler is mocked to return each error; org RBAC passes.
 */
import { createProcedureClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../../context";

import { ProjectNotFoundError } from "../../project/errors";
import { EnvironmentDatabaseError } from "../errors";

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
const projectId = idSchema.project.parse("prj_elsewhere");

const createEnv = vi.fn<
  () => Promise<Result<never, ProjectNotFoundError | EnvironmentDatabaseError>>
>(async () => Result.err(new ProjectNotFoundError({ projectId })));

vi.mock("../handlers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handlers")>();
  return { ...actual, createEnv };
});

// The caller is a current member of its organization: the org-scoped guard's
// per-request membership lookup is not what this test exercises.
vi.mock("../../../authz/org-member", () => ({ isOrgMember: vi.fn(async () => true) }));

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: vi.fn(async () => ({ success: true })) } },
}));

const { envRouter } = await import("../index");

function sessionContext(): Context {
  const actor = {
    kind: "session" as const,
    headers: new Headers(),
    user: {
      id: "usr_caller",
      email: "caller@org-a.test",
      isInstallAdmin: false,
      twoFactorEnabled: true,
    },
    session: { activeOrganizationId: orgId },
  };
  return {
    actor,
    session: actor,
    apiKey: null,
    apiKeyRateLimited: null,
    activeOrganizationId: orgId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/envs" }),
    broadcast: vi.fn(),
  };
}

describe("env.create answers typed errors", () => {
  it("a project outside the caller's org is NOT_FOUND", async () => {
    const client = createProcedureClient(envRouter.create, { context: sessionContext() });

    await expect(client({ name: "Staging", slug: "staging", projectId })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      message: "Project not found",
    });
    expect(createEnv).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, organizationId: orgId }),
    );
  });

  it("an unexpected database failure is INTERNAL_SERVER_ERROR with the summarised cause", async () => {
    const failure = new EnvironmentDatabaseError({ cause: new Error("connection reset") });
    createEnv.mockResolvedValueOnce(Result.err(failure));
    const client = createProcedureClient(envRouter.create, { context: sessionContext() });

    await expect(client({ name: "Staging", slug: "staging" })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      status: 500,
      data: { cause: failure.cause },
    });
  });
});
