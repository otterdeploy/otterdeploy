import { createProcedureClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../../context";

import { ProjectResourceDeleteError } from "../errors";

const organizationId = idSchema.organization.parse("org_delete");
const projectId = idSchema.project.parse("prj_delete");
const deleteProject = vi.fn<typeof import("../handlers").deleteProject>(async () =>
  Result.ok({ ok: true }),
);
const hasPermission = vi.fn(async () => ({ success: true }));
vi.mock("../handlers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../handlers")>()),
  deleteProject,
}));
vi.mock("../../../authz/org-member", () => ({ isOrgMember: vi.fn(async () => true) }));
vi.mock("@otterdeploy/auth", () => ({ auth: { api: { hasPermission } } }));
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
    session: { activeOrganizationId: organizationId },
  };
  return {
    actor,
    session: actor,
    apiKey: null,
    apiKeyRateLimited: null,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/project" }),
    broadcast: vi.fn(),
  };
}

beforeEach(() => {
  deleteProject.mockClear();
  hasPermission.mockClear();
});
describe("project delete procedure", () => {
  it("forwards explicit contents deletion and requires service-delete permission too", async () => {
    const client = createProcedureClient(projectRouter.delete, { context: sessionContext() });
    expect(await client({ id: projectId, deleteContents: true })).toEqual({ ok: true });
    expect(deleteProject).toHaveBeenCalledWith(
      { id: projectId, deleteContents: true, organizationId },
      expect.anything(),
    );
    expect(hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          permissions: { project: ["delete"], service: ["delete"] },
        }),
      }),
    );
  });
  it("returns an actionable typed conflict when a resource cannot be deleted", async () => {
    deleteProject.mockImplementationOnce(async () =>
      Result.err(
        new ProjectResourceDeleteError({
          resourceName: "database",
          message: "Database has branches",
        }),
      ),
    );
    const client = createProcedureClient(projectRouter.delete, { context: sessionContext() });
    await expect(client({ id: projectId, deleteContents: true })).rejects.toMatchObject({
      code: "RESOURCE_DELETE_FAILED",
      status: 409,
      message: "Database has branches",
      data: { resourceName: "database" },
    });
  });
});
