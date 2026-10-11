/**
 * An environment override that does not merge into a valid manifest reaches
 * the caller as a typed 400, never a 500.
 *
 * merge-invalid-override.test.ts proves `resolveEnvironment` returns a
 * ManifestMergeError instead of throwing. This drives the real oRPC
 * procedures and checks the router maps it onto INVALID_MANIFEST, with the
 * message naming the environment and the resource. `applyChange` must refuse
 * before it saves: persisting a manifest it then cannot apply would leave the
 * broken override staged.
 */
import { createProcedureClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { describe, expect, it, vi } from "vite-plus/test";

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

const getProject = vi.fn(async () => Result.ok({ id: projectId }));
vi.mock("../handlers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handlers")>();
  return { ...actual, getProject };
});

const saveManifest = vi.fn(async () => Result.ok({ version: 2 }));
vi.mock("../manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../manifest")>();
  return {
    ...actual,
    saveManifest,
    loadManifest: vi.fn(async () => Result.ok({ manifest: null, version: 1 })),
  };
});
// Placement is checked before the override; nothing here asks for one.
vi.mock("../manifest-apply-placement", () => ({
  refuseUnrunnablePlacement: vi.fn(async () => Result.ok(undefined)),
}));

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

/** `ghost` exists only in staging and never says what its source is, so the
 *  merged services map is not a valid one. */
const brokenOverride = {
  project: "acme-api",
  services: { web: { source: "image" as const, image: "nginx" } },
  databases: {},
  composes: {},
  environments: { staging: { services: { ghost: { image: "nginx" } } } },
};

describe("an environment override that does not merge is a typed 400", () => {
  it("manifest.diff answers INVALID_MANIFEST naming the environment and resource", async () => {
    const client = createProcedureClient(projectRouter.manifest.diff, {
      context: sessionContext(),
    });

    const call = client({ projectId, environment: "staging", manifest: brokenOverride });

    await expect(call).rejects.toMatchObject({ code: "INVALID_MANIFEST", status: 400 });
    await expect(call).rejects.toThrow(/staging[\s\S]*ghost/);
  });

  it("manifest.applyChange answers INVALID_MANIFEST before saving anything", async () => {
    saveManifest.mockClear();
    const client = createProcedureClient(projectRouter.manifest.applyChange, {
      context: sessionContext(),
    });

    const call = client({
      projectId,
      environment: "staging",
      manifest: brokenOverride,
      expectedVersion: 1,
    });

    await expect(call).rejects.toMatchObject({ code: "INVALID_MANIFEST", status: 400 });
    expect(saveManifest).not.toHaveBeenCalled();
  });
});
