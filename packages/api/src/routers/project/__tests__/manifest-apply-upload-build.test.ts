/**
 * An upload service builds too, so a changed `build` block on an
 * existing one has to stage an update AND reach the row. Both legs were gated
 * on `source === "git"`: the diff never compared an upload's build config and
 * apply never wrote it, so the edit silently did nothing.
 */
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { CurrentService, CurrentState } from "../../../stack/manifest/diff";

import { diffManifest } from "../../../stack/manifest/diff";
import { manifestSchema } from "../../../stack/manifest/schema";
import { buildUpdateServiceInput } from "../manifest-apply-services";

function liveUpload(over: Partial<CurrentService> = {}): CurrentState {
  return {
    services: {
      web: {
        name: "web",
        source: "upload",
        image: "otterdeploy-local/web:dep_1",
        sourceSubdir: null,
        repo: null,
        branch: null,
        imageRepository: null,
        replicas: 1,
        command: null,
        entrypoint: null,
        ports: [],
        env: {},
        publicEnabled: false,
        previewsEnabled: false,
        preDeploy: null,
        postDeploy: null,
        buildConfig: { builder: "auto" },
        restartCondition: "on-failure",
        restartMaxAttempts: null,
        restartDelayMs: 5000,
        restartWindowMs: null,
        cpuLimit: null,
        memoryLimitMb: null,
        cpuReservation: null,
        memoryReservationMb: null,
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

const RAILPACK = { builder: "railpack", buildCommand: "npm run build:prod" } as const;

function uploadManifest(build?: unknown) {
  return manifestSchema.parse({
    project: "acme",
    services: { web: { source: "upload", ...(build === undefined ? {} : { build }) } },
  });
}

// Complete no-op logger: the builder under test threads `log` but never calls it.
const noopLog: RequestLogger = {
  set: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  emit: () => null,
  getContext: () => ({}),
};

describe("upload service build config", () => {
  it("stages a changed build block", () => {
    expect(diffManifest(uploadManifest(RAILPACK), liveUpload())).toEqual([
      {
        kind: "update",
        resource: "service",
        name: "web",
        details: { fields: { buildConfig: { from: { builder: "auto" }, to: RAILPACK } } },
      },
    ]);
  });

  it("is a no-op once applied, and when the block is omitted", () => {
    const applied = liveUpload({ buildConfig: RAILPACK });
    const noOp = [{ kind: "no-op", resource: "service", name: "web" }];
    expect(diffManifest(uploadManifest(RAILPACK), applied)).toEqual(noOp);
    expect(diffManifest(uploadManifest(), applied)).toEqual(noOp);
  });

  it("carries the declared block into the update patch, and only when declared", () => {
    const args = (build?: unknown) => {
      const spec = uploadManifest(build).services.web;
      if (!spec) throw new Error("manifest has no `web` service");
      return {
        projectId: idSchema.project.parse("prj_1"),
        organizationId: idSchema.organization.parse("org_1"),
        resourceId: idSchema.resource.parse("res_1"),
        name: "web",
        spec,
        env: [],
        log: noopLog,
      };
    };
    expect(buildUpdateServiceInput(args(RAILPACK), null).buildConfig).toEqual(RAILPACK);
    expect("buildConfig" in buildUpdateServiceInput(args(), null)).toBe(false);
  });
});
