/**
 * The root-directory round trip: staging a new `sourceSubdir` in the manifest
 * has to survive all the way to the `service_resource` SET list.
 *
 * It used to die halfway. The diff surfaced the change and the pending bar
 * showed it, but `buildUpdateServiceInput` never passed `sourceSubdir` and
 * `updateServiceRecord` stripped it anyway — so Apply reported success, wrote
 * nothing, and the next diff staged the identical change again. Forever.
 *
 * Each leg is asserted separately so a regression names the leg that broke.
 */

import type { RequestLogger } from "evlog";

import { describe, expect, it } from "vite-plus/test";

import type { CurrentState } from "../../../stack/manifest/diff";
import type { ServiceManifest } from "../../../stack/manifest/schema";

import { diffManifest } from "../../../stack/manifest/diff";
import { manifestSchema, type Manifest } from "../../../stack/manifest/schema";
import { toUpdateRecordPatch } from "../../service/inputs";
import { buildUpdateServiceInput } from "../manifest-apply-services";

function manifest(input: unknown): Manifest {
  return manifestSchema.parse(input);
}

/** A live git service bound to `apps/web`. */
function liveGitService(over: Partial<CurrentState["services"][string]> = {}): CurrentState {
  return {
    services: {
      web: {
        name: "web",
        source: "git",
        image: "ghcr.io/acme/api:abc123",
        sourceSubdir: "apps/web",
        repo: "acme/api",
        branch: "main",
        imageRepository: "ghcr.io/acme/api",
        replicas: 1,
        command: null,
        entrypoint: null,
        ports: [],
        env: {},
        publicEnabled: false,
        previewsEnabled: false,
        preDeploy: null,
        postDeploy: null,
        buildConfig: null,
        restartWindowMs: null,
        diskLimitMb: null,
        swapLimitMb: null,
        pidsLimit: null,
        ...over,
      },
    },
    databases: {},
    composes: {},
  };
}

const gitService = (over: Record<string, unknown> = {}) => ({
  source: "git",
  repo: "acme/api",
  branch: "main",
  imageRepository: "ghcr.io/acme/api",
  ...over,
});

const updateArgs = (spec: ServiceManifest) => ({
  projectId: "proj_1" as never,
  organizationId: "org_1" as never,
  name: "web",
  resourceId: "res_1" as never,
  spec,
  env: [],
  log: {} as RequestLogger,
});

/** The declared git source block out of a parsed manifest. */
function specOf(m: Manifest): ServiceManifest {
  const svc = m.services.web;
  if (!svc) throw new Error("fixture has no `web` service");
  return svc;
}

describe("root directory: manifest → diff", () => {
  it("stages a change when the manifest moves the service to another folder", () => {
    const m = manifest({
      project: "acme-api",
      services: { web: gitService({ sourceSubdir: "apps/api" }) },
    });
    expect(diffManifest(m, liveGitService())).toEqual([
      {
        kind: "update",
        resource: "service",
        name: "web",
        details: { fields: { sourceSubdir: { from: "apps/web", to: "apps/api" } } },
      },
    ]);
  });

  it("stages a change when the folder is cleared back to the repo root", () => {
    const m = manifest({
      project: "acme-api",
      services: { web: gitService({ sourceSubdir: null }) },
    });
    expect(diffManifest(m, liveGitService())).toEqual([
      {
        kind: "update",
        resource: "service",
        name: "web",
        details: { fields: { sourceSubdir: { from: "apps/web", to: null } } },
      },
    ]);
  });
});

describe("root directory: diff → apply", () => {
  it("carries a declared sourceSubdir into the update patch", () => {
    const m = manifest({
      project: "acme-api",
      services: { web: gitService({ sourceSubdir: "apps/api" }) },
    });
    const input = buildUpdateServiceInput(updateArgs(specOf(m)), "gitrepo_1" as never);
    expect(input.sourceSubdir).toBe("apps/api");
  });

  it("carries an explicit null (move back to the repo root is a real edit)", () => {
    const m = manifest({
      project: "acme-api",
      services: { web: gitService({ sourceSubdir: null }) },
    });
    const input = buildUpdateServiceInput(updateArgs(specOf(m)), "gitrepo_1" as never);
    expect(input.sourceSubdir).toBeNull();
  });

  it("leaves an undeclared sourceSubdir alone, matching the diff gate", () => {
    // Same declared-only rule as `repo`/`previews`: an omitted key means the
    // live value is user-managed. Defaulting it to null here would clear a
    // folder binding on every apply of a manifest that never mentions it.
    const m = manifest({ project: "acme-api", services: { web: gitService() } });
    const input = buildUpdateServiceInput(updateArgs(specOf(m)), "gitrepo_1" as never);
    expect("sourceSubdir" in input).toBe(false);
  });

  it("does not rebind the folder for an image-sourced service", () => {
    const m = manifest({
      project: "acme-api",
      services: { web: { source: "image", image: "ghcr.io/acme/api:1.0.0" } },
    });
    const input = buildUpdateServiceInput(updateArgs(specOf(m)), null);
    expect("sourceSubdir" in input).toBe(false);
  });

  it("applies a folder move without a repo rebinding", () => {
    // The Source card can move a service between folders in the SAME repo.
    // Gating sourceSubdir behind the `repo !== undefined` check would have
    // made that the one edit the card cannot land.
    const m = manifest({
      project: "acme-api",
      services: { web: { source: "git", sourceSubdir: "apps/api" } },
    });
    const input = buildUpdateServiceInput(updateArgs(specOf(m)), null);
    expect(input.sourceSubdir).toBe("apps/api");
    expect("gitRepoId" in input).toBe(false);
  });
});

describe("root directory: apply → column patch", () => {
  const patch = (over: { sourceSubdir?: string | null } = {}) =>
    toUpdateRecordPatch({
      projectId: "proj_1" as never,
      organizationId: "org_1" as never,
      resourceId: "res_1" as never,
      ...over,
    });

  it("keeps sourceSubdir in the SET list", () => {
    expect(patch({ sourceSubdir: "apps/api" }).sourceSubdir).toBe("apps/api");
  });

  it("passes an explicit null through so the column is cleared", () => {
    expect(patch({ sourceSubdir: null }).sourceSubdir).toBeNull();
  });

  it("leaves it undefined when the patch omits it (omitUndefined drops the key)", () => {
    expect(patch().sourceSubdir).toBeUndefined();
  });
});
