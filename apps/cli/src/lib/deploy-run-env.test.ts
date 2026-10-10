/**
 * `otd deploy --env staging` on an upload-sourced service. The
 * source went to PRODUCTION's `web` and the wait followed production, because
 * the resource lookups after the apply never named the environment; staging's
 * `web` was created and never built. Every step after the apply must act on
 * the environment the deploy targeted.
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

interface Upload {
  resourceId: string;
}
const uploads: Upload[] = [];
const waited: Array<{ resourceId: string; name: string }> = [];
const listed: Array<string | undefined> = [];
const applied: Array<{ environment?: string; sourceUploads?: string[] }> = [];

// The base manifest ships `web` from a git repo; staging's override turns it
// into an upload-sourced service. Production keeps the git one.
const localManifest = {
  project: "shop",
  services: { web: { source: "git", repo: "acme/shop", branch: "main" } },
  databases: {},
  composes: {},
  environments: {
    staging: { services: { web: { source: "upload" } } },
  },
};

const fakeClient = {
  env: {
    list: async () => [
      { id: "env_prod", slug: "production" },
      { id: "env_stage", slug: "staging" },
    ],
  },
  project: {
    getBySlug: async () => ({ id: "prj_shop", slug: "shop", name: "shop" }),
    resource: {
      // Like the server: no environmentId means the main environment.
      list: async ({ environmentId }: { environmentId?: string }) => {
        listed.push(environmentId);
        return environmentId === "env_stage"
          ? [{ type: "service", name: "web", resourceId: "res_stage_web" }]
          : [{ type: "service", name: "web", resourceId: "res_prod_web" }];
      },
    },
    manifest: {
      get: async () => ({ version: 1, manifest: localManifest }),
      diff: async () => ({
        resolved: null,
        changes: [{ kind: "create", resource: "service", name: "web" }],
      }),
      save: async () => ({ version: 2 }),
      applyChange: async (input: { environment?: string; sourceUploads?: string[] }) => {
        applied.push({ environment: input.environment, sourceUploads: input.sourceUploads });
        return { appliedCount: 1, skipped: [], rollouts: [], version: 2 };
      },
    },
  },
};

vi.mock("../auth-flow", () => ({
  ensureAuthenticated: async () => ({ url: "http://127.0.0.1:1", token: "otter_test" }),
}));
vi.mock("../client", () => ({ createCliClient: () => fakeClient }));
vi.mock("../config-file", () => ({
  configPath: () => "/nonexistent/otterdeploy.json",
  loadConfig: async () => localManifest,
}));
vi.mock("./tar-source", () => ({ createSourceTarball: () => "/nonexistent/src.tgz" }));
vi.mock("./upload-source", () => ({
  uploadSource: async (args: Upload) => {
    uploads.push({ resourceId: args.resourceId });
    return { deploymentId: "dep_1", sourceSha: "abcdef0123" };
  },
}));
vi.mock("./wait", () => ({
  waitForDeployments: async (args: { targets: Array<{ resourceId: string; name: string }> }) => {
    waited.push(...args.targets);
    return { ok: true, outcomes: [] };
  },
}));
vi.mock("./ui", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return {
    ...real,
    abort: (message: string) => {
      throw new Error(message);
    },
    note: () => {},
    ok: () => {},
    out: () => {},
    section: () => {},
    detail: () => {},
  };
});

import { runDeploy } from "./deploy-run";

beforeEach(() => {
  uploads.length = 0;
  waited.length = 0;
  listed.length = 0;
  applied.length = 0;
});

describe("otd deploy --env", () => {
  it("uploads to and waits on the TARGET environment's service, never production's", async () => {
    await runDeploy({ env: "staging", yes: true, wait: true });

    expect(uploads).toEqual([{ resourceId: "res_stage_web" }]);
    expect(waited).toEqual([{ resourceId: "res_stage_web", name: "web" }]);
    // Every lookup after the apply named staging's environment id.
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((id) => id === "env_stage")).toBe(true);
  });

  it("names the upload services from the manifest AS RESOLVED for that environment", async () => {
    await runDeploy({ env: "staging", yes: true });
    // `web` is git-sourced in the base block and upload-sourced only under
    // staging's override: the apply must be told it rides an upload.
    expect(applied).toEqual([{ environment: "staging", sourceUploads: ["web"] }]);
  });

  it("without --env, the base manifest decides and production's service is the target", async () => {
    await runDeploy({ yes: true, wait: true });
    // `web` is a git service in the base block: nothing to upload.
    expect(uploads).toEqual([]);
    expect(applied).toEqual([{ environment: undefined, sourceUploads: [] }]);
    expect(waited).toEqual([{ resourceId: "res_prod_web", name: "web" }]);
  });
});
