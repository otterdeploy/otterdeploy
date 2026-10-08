import { describe, expect, test } from "vite-plus/test";

import { buildSandboxRecommendations, buildSandboxStatusSchema } from "../build-sandbox";

const at = "2026-10-07T15:30:00Z";

describe("buildSandboxRecommendations (od-48w)", () => {
  test("a failed sandbox is a critical card that carries the builder's reason", () => {
    const [rec, ...rest] = buildSandboxRecommendations({
      state: "failed",
      reason: "otterdeploy-buildkitd did not become ready. Prepare it with `install.sh update`",
      image: "moby/buildkit:v0.33.1-rootless",
      checkedAt: at,
    });
    expect(rest).toEqual([]);
    expect(rec?.severity).toBe("critical");
    expect(rec?.id).toBe("build-sandbox-down");
    expect(rec?.detail).toContain("install.sh update");
  });

  test("the unisolated opt-out is a standing warning", () => {
    const recs = buildSandboxRecommendations({
      state: "unisolated",
      reason: "BUILDER_ALLOW_UNISOLATED=true",
      image: "",
      checkedAt: at,
    });
    expect(recs.map((r) => [r.id, r.severity])).toEqual([["build-sandbox-unisolated", "warning"]]);
  });

  test("a ready sandbox, or no status yet, adds nothing", () => {
    expect(
      buildSandboxRecommendations({ state: "ready", reason: null, image: "x", checkedAt: at }),
    ).toEqual([]);
    expect(buildSandboxRecommendations(null)).toEqual([]);
  });

  test("the status schema rejects a file the builder did not write", () => {
    expect(buildSandboxStatusSchema.safeParse({ state: "maybe" }).success).toBe(false);
  });
});
