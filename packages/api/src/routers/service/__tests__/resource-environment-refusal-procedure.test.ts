/**
 * An environment that is not the project's own reaches the caller as
 * a typed refusal, never a 500 and never a stranded row.
 *
 * resource-environment-integrity.postgres.test.ts proves the domain layer
 * refuses such an id (another project's, another org's, or none) with
 * ResourceEnvironmentNotFoundError before any row exists. This drives the real
 * oRPC procedures, middleware ladder included, and checks each create router
 * maps that error onto a typed contract error carrying the reason. The domain
 * calls are mocked to return the refusal; org RBAC passes.
 */
import { createProcedureClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../../context";

import { ResourceEnvironmentNotFoundError } from "../../project/queries/new-resource-environment";

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
const projectId = idSchema.project.parse("prj_mine");
const foreignEnvironmentId = idSchema.environment.parse("env_someone_elses");
const refusal = () => new ResourceEnvironmentNotFoundError({ environmentId: foreignEnvironmentId });

const createService = vi.fn(async () => Result.err(refusal()));
const validatePostgresCreate = vi.fn(async () => Result.err(refusal()));

vi.mock("../handlers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handlers")>();
  return { ...actual, createService };
});

vi.mock("../../project/postgres/create-stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../project/postgres/create-stream")>();
  return { ...actual, validatePostgresCreate };
});

// The caller is a current member of its organization: the org-scoped guard's
// per-request membership lookup is not what these tests exercise.
vi.mock("../../../authz/org-member", () => ({ isOrgMember: vi.fn(async () => true) }));

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: vi.fn(async () => ({ success: true })) } },
}));

const { serviceRouter } = await import("../index");
const { postgresResourceRouter } = await import("../../project/router-resource-postgres");

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
    log: createRequestLogger({ method: "TEST", path: "/resource-environment" }),
    broadcast: vi.fn(),
  };
}

describe("a foreign environment is a typed refusal at the procedure", () => {
  it("service.create answers INVALID_INPUT naming the environment", async () => {
    const client = createProcedureClient(serviceRouter.create, { context: sessionContext() });

    await expect(
      client({ projectId, name: "api", image: "nginx:alpine", ports: [] }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      defined: true,
      message: refusal().message,
    });
    expect(createService).toHaveBeenCalledOnce();
  });

  it("postgres create answers NOT_FOUND naming the environment", async () => {
    const client = createProcedureClient(postgresResourceRouter.create, {
      context: sessionContext(),
    });

    await expect(client({ projectId, name: "db" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      defined: true,
      message: refusal().message,
    });
    expect(validatePostgresCreate).toHaveBeenCalledOnce();
  });
});
