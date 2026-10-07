/**
 * A taken project slug reaches the caller as a typed 409.
 *
 * `createProject` / `updateProject` refuse a slug any organization already
 * holds with a ProjectConflictError carrying a free `suggestedSlug`
 * (project-slug-global.postgres.test.ts proves that against a real database).
 * This drives the real oRPC procedures, middleware ladder included, and checks
 * the router maps that error onto the contract's CONFLICT with the slug and the
 * suggestion in `data`, so the web and CLI can offer the free slug. The
 * handlers module is mocked to return the conflict; org RBAC passes.
 */
import { createProcedureClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../../context";

import { ProjectConflictError } from "../errors";

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
const conflict = () => new ProjectConflictError({ slug: "shop", suggestedSlug: "shop-2" });

const createProject = vi.fn(async () => Result.err(conflict()));
const updateProject = vi.fn(async () => Result.err(conflict()));

vi.mock("../handlers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handlers")>();
  return { ...actual, createProject, updateProject };
});

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
    activeOrganizationId: orgId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/project" }),
    broadcast: vi.fn(),
  };
}

const slugConflict = {
  code: "CONFLICT",
  status: 409,
  message: conflict().message,
  data: { slug: "shop", suggestedSlug: "shop-2" },
};

describe("a taken project slug is a 409 CONFLICT with a free suggestion", () => {
  it("project.create answers CONFLICT with the slug and a suggested free slug", async () => {
    const client = createProcedureClient(projectRouter.create, { context: sessionContext() });

    await expect(client({ name: "Shop", slug: "shop" })).rejects.toMatchObject(slugConflict);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "shop", organizationId: orgId }),
    );
  });

  it("project.update answers CONFLICT with the slug and a suggested free slug", async () => {
    const client = createProcedureClient(projectRouter.update, { context: sessionContext() });

    await expect(client({ id: projectId, slug: "shop" })).rejects.toMatchObject(slugConflict);
    expect(updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: projectId, slug: "shop", organizationId: orgId }),
    );
  });
});
