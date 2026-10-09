/**
 * An environment id project.create may not claim reaches the
 * caller as a typed 409, never a 500 and never a slug conflict.
 *
 * project-environment-claim.postgres.test.ts proves `createProject` refuses
 * such an id (another project's, another org's standalone row, or one too old
 * to name its org) with ProjectEnvironmentUnavailableError before anything is
 * written. This drives the real oRPC procedure, middleware ladder included, and
 * checks the router maps that error onto the contract's ENVIRONMENT_UNAVAILABLE,
 * with no slug data to mislead the client into retrying under another slug.
 * The handler is mocked to return the refusal; org RBAC passes.
 */
import { createProcedureClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../../context";

import { ProjectEnvironmentUnavailableError } from "../errors";

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
const environmentId = idSchema.environment.parse("env_taken");
const refusal = () => new ProjectEnvironmentUnavailableError({ environmentId });

const createProject = vi.fn(async () => Result.err(refusal()));

vi.mock("../handlers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handlers")>();
  return { ...actual, createProject };
});

// The caller is a current member of its organization: the org-scoped guard's
// per-request membership lookup is not what this test exercises.
vi.mock("../../../authz/org-member", () => ({ isOrgMember: vi.fn(async () => true) }));

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: vi.fn(async () => ({ success: true })) } },
}));

const { projectRouter } = await import("../index");

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
    log: createRequestLogger({ method: "TEST", path: "/project" }),
    broadcast: vi.fn(),
  };
}

describe("an unclaimable environment id is a typed 409", () => {
  it("project.create answers ENVIRONMENT_UNAVAILABLE, not a 500 or a slug conflict", async () => {
    const client = createProcedureClient(projectRouter.create, { context: sessionContext() });

    await expect(client({ name: "Shop", slug: "shop", environmentId })).rejects.toMatchObject({
      code: "ENVIRONMENT_UNAVAILABLE",
      status: 409,
      message: refusal().message,
    });
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId, organizationId: orgId }),
    );
  });
});
