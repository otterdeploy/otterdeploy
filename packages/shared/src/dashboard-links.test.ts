import { describe, expect, test } from "bun:test";

import { previewDeploymentUrl, projectUrl } from "./dashboard-links";

describe("previewDeploymentUrl", () => {
  test("links a preview deployment under its project, environment and resource", () => {
    expect(
      previewDeploymentUrl({
        base: "https://panel.example.com",
        orgSlug: "acme",
        projectSlug: "somnara",
        envSlug: "production",
        resourceId: "res_1",
        deploymentId: "dep_1",
        previewId: "prv_1",
      }),
    ).toBe(
      "https://panel.example.com/acme/projects/somnara/production/r/res_1/deployments/dep_1?previewId=prv_1",
    );
  });

  test("tolerates a trailing slash on the base and encodes the segments", () => {
    expect(
      previewDeploymentUrl({
        base: "https://panel.example.com/",
        orgSlug: "acme",
        projectSlug: "somnara",
        envSlug: "production",
        resourceId: "compose:web app",
        deploymentId: "dep_1",
        previewId: "prv_1",
      }),
    ).toBe(
      "https://panel.example.com/acme/projects/somnara/production/r/compose%3Aweb%20app/deployments/dep_1?previewId=prv_1",
    );
  });
});

describe("projectUrl", () => {
  test("opens the project, an environment, or a resource in it", () => {
    const base = { base: "https://panel.example.com", orgSlug: "acme", projectSlug: "shop" };
    expect(projectUrl(base)).toBe("https://panel.example.com/acme/projects/shop");
    expect(projectUrl({ ...base, envSlug: "staging" })).toBe(
      "https://panel.example.com/acme/projects/shop/staging",
    );
    expect(projectUrl({ ...base, envSlug: "staging", resourceId: "res_9" })).toBe(
      "https://panel.example.com/acme/projects/shop/staging/r/res_9",
    );
  });
});
