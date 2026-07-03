import type { EnvironmentId } from "@otterdeploy/shared/id";

import { describe, expect, it } from "vitest";

import {
  isPreviewEnv,
  previewHostLabel,
  previewSlug,
  runtimeServiceName,
  type EnvScope,
} from "./scoping";

const persistent: EnvScope = {
  id: "env_prod" as EnvironmentId,
  kind: "persistent",
  slug: "app-production",
};
const preview: EnvScope = {
  id: "env_pr7" as EnvironmentId,
  kind: "preview",
  slug: "app-pr-7",
  pullRequestNumber: 7,
};

describe("environment scoping", () => {
  it("isPreviewEnv narrows correctly", () => {
    expect(isPreviewEnv(persistent)).toBe(false);
    expect(isPreviewEnv(preview)).toBe(true);
    expect(isPreviewEnv(null)).toBe(false);
    expect(isPreviewEnv(undefined)).toBe(false);
  });

  it("previewSlug prefers the PR number, falls back to slug", () => {
    expect(previewSlug(preview)).toBe("pr-7");
    expect(previewSlug({ ...preview, pullRequestNumber: null })).toBe("app-pr-7");
  });

  it("runtimeServiceName leaves persistent envs untouched (production byte-identical)", () => {
    expect(runtimeServiceName("web", persistent)).toBe("web");
    expect(runtimeServiceName("web", null)).toBe("web");
    expect(runtimeServiceName("web", undefined)).toBe("web");
  });

  it("runtimeServiceName suffixes preview envs with the pr slug", () => {
    expect(runtimeServiceName("web", preview)).toBe("web-pr-7");
  });

  it("previewHostLabel scopes preview hosts, leaves persistent alone", () => {
    expect(previewHostLabel("web", persistent)).toBe("web");
    expect(previewHostLabel("web", preview)).toBe("web-pr-7");
  });
});
