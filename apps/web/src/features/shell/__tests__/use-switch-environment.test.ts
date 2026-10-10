import { describe, expect, it } from "vite-plus/test";

import { switchedEnvironmentPath } from "../use-switch-environment";

const base = { orgSlug: "acme", projectSlug: "shop" };

describe("switchedEnvironmentPath", () => {
  it("swaps the environment segment and keeps the page", () => {
    expect(
      switchedEnvironmentPath({
        ...base,
        pathname: "/acme/projects/shop/production/logs/edge",
        currentEnvSlug: "production",
        nextEnvSlug: "staging",
      }),
    ).toBe("/acme/projects/shop/staging/logs/edge");
  });

  it("keeps an open resource panel open in the new environment", () => {
    expect(
      switchedEnvironmentPath({
        ...base,
        pathname: "/acme/projects/shop/production/r/res_1/settings",
        currentEnvSlug: "production",
        nextEnvSlug: "staging",
      }),
    ).toBe("/acme/projects/shop/staging/r/res_1/settings");
  });

  it("opens the environment's canvas from a page that has no environment", () => {
    expect(
      switchedEnvironmentPath({
        ...base,
        pathname: "/acme/projects/shop/settings",
        currentEnvSlug: undefined,
        nextEnvSlug: "staging",
      }),
    ).toBe("/acme/projects/shop/staging");
  });

  it("does not mistake a slug prefix for the segment", () => {
    // `prod` is a prefix of `production`, not the same segment.
    expect(
      switchedEnvironmentPath({
        ...base,
        pathname: "/acme/projects/shop/production/logs",
        currentEnvSlug: "prod",
        nextEnvSlug: "staging",
      }),
    ).toBe("/acme/projects/shop/staging");
  });
});
