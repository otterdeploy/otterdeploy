/**
 * The root-directory round trip: staging a new `sourceSubdir` in the manifest
 * has to survive all the way to the `service_resource` SET list.
 *
 * It used to die halfway. The diff surfaced the change and the pending bar
 * showed it, but `buildUpdateServiceInput` never passed `sourceSubdir` and
 * `updateServiceRecord` stripped it anyway, so Apply reported success, wrote
 * nothing, and the next diff staged the identical change again. Forever.
 *
 * Each leg is asserted separately so a regression names the leg that broke.
 */

import type { JsonObject } from "@otterdeploy/shared/json";
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
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

// Pre-parse manifest JSON. The fixture feeds `manifestSchema.parse`.
const gitService = (over: JsonObject = {}) => ({
  source: "git",
  repo: "acme/api",
  branch: "main",
  imageRepository: "ghcr.io/acme/api",
  ...over,
});

// Branded ids minted through the real boundary validators, not cast fixtures.
const PROJECT_ID = idSchema.project.parse("prj_1");
const ORGANIZATION_ID = idSchema.organization.parse("org_1");
const RESOURCE_ID = idSchema.resource.parse("res_1");
const GIT_REPO_ID = idSchema.gitRepo.parse("gitr_1");

// Complete no-op logger: the builders under test thread `log` but never call
// it, so an inert full implementation is the honest fixture.
const noopLog: RequestLogger = {
  set: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  emit: () => null,
  getContext: () => ({}),
};

const updateArgs = (spec: ServiceManifest) => ({
  projectId: PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  name: "web",
  resourceId: RESOURCE_ID,
  spec,
  env: [],
  log: noopLog,
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
    const input = buildUpdateServiceInput(updateArgs(specOf(m)), GIT_REPO_ID);
    expect(input.sourceSubdir).toBe("apps/api");
  });

  it("carries an explicit null (move back to the repo root is a real edit)", () => {
    const m = manifest({
      project: "acme-api",
      services: { web: gitService({ sourceSubdir: null }) },
    });
    const input = buildUpdateServiceInput(updateArgs(specOf(m)), GIT_REPO_ID);
    expect(input.sourceSubdir).toBeNull();
  });

  it("leaves an undeclared sourceSubdir alone, matching the diff gate", () => {
    // Same declared-only rule as `repo`/`previews`: an omitted key means the
    // live value is user-managed. Defaulting it to null here would clear a
    // folder binding on every apply of a manifest that never mentions it.
    const m = manifest({ project: "acme-api", services: { web: gitService() } });
    const input = buildUpdateServiceInput(updateArgs(specOf(m)), GIT_REPO_ID);
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
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
      resourceId: RESOURCE_ID,
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
