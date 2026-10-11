/**
 * Apply used to collect every created git service and enqueue their builds in
 * one last phase, after stacks, database updates and deletes had run. Anything
 * that aborted the apply in between left the service created on its
 * placeholder image with no build, and since it then matched the manifest it
 * diffed as a no-op on every later apply: "not deployed" until someone clicked
 * Deploy. The build is now enqueued by the create itself.
 */
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ApplyContext } from "../manifest-apply-phases";

const enqueueGitBuild = vi.hoisted(() => vi.fn());

vi.mock("../manifest-apply-git", () => ({ enqueueGitBuild }));
vi.mock("../manifest-apply-services", () => ({
  createServiceFromManifest: async () => Result.ok({ resourceId: "res_web", deploymentId: null }),
  seedServiceDomains: async () => [],
  updateServiceFromManifest: vi.fn(),
}));

const { manifestSchema } = await import("../../../stack/manifest/schema");
const { runServiceCreates } = await import("../manifest-apply-phases-services");

const log: RequestLogger = {
  set: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  emit: () => null,
  getContext: () => ({}),
};

function context(): ApplyContext {
  return {
    projectId: idSchema.project.parse("prj_1"),
    environmentId: idSchema.environment.parse("env_main"),
    scope: { environmentId: idSchema.environment.parse("env_main"), isMain: true },
    organizationId: idSchema.organization.parse("org_1"),
    manifest: manifestSchema.parse({
      project: "acme",
      services: { web: { source: "git", repo: "acme/web" } },
    }),
    current: { services: {}, databases: {}, composes: {} },
    sourceUploads: new Set(),
    log,
  };
}

describe("a git service created by apply", () => {
  it("has its build enqueued by the create phase itself", async () => {
    enqueueGitBuild.mockResolvedValue(Result.ok({ deploymentId: "dep_1" }));
    const ctx = context();
    const contribution = await runServiceCreates(
      ctx,
      [{ kind: "create", resource: "service", name: "web" }],
      { databases: new Map(), services: new Map() },
    );
    expect(contribution.applied).toBe(1);
    expect(enqueueGitBuild).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "res_web", projectId: "prj_1" }),
    );
  });

  it("reports a build that could not start, against the service", async () => {
    enqueueGitBuild.mockResolvedValue(Result.err("could not resolve main head: 404"));
    const contribution = await runServiceCreates(
      context(),
      [{ kind: "create", resource: "service", name: "web" }],
      { databases: new Map(), services: new Map() },
    );
    expect(contribution.skipped.map((s) => s.reason)).toEqual([
      "created but build not started: could not resolve main head: 404",
    ]);
  });
});
