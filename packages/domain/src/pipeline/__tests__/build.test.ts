import { describe, it, expect, vi } from "vitest";
import { Result } from "better-result";

import { buildImage, type BuildDeps } from "../build";
import type { ResourceConfig } from "../types";

const mockResource: ResourceConfig = {
  id: "res-1",
  name: "web-app",
  kind: "web",
  port: 3000,
  healthCheckPath: "/health",
  healthCheckInterval: 30,
  healthCheckTimeout: 10,
  replicas: 1,
  cpuLimit: null,
  memoryLimit: null,
  startCommand: "node server.js",
  preDeployCommand: null,
  restartPolicy: "ALWAYS",
  restartPolicyMaxRetries: null,
  builder: "nixpacks",
  dockerfilePath: "Dockerfile",
  buildCommand: null,
  serverId: null,
};

function createMockBuildDeps(overrides: Partial<BuildDeps> = {}): BuildDeps {
  return {
    buildImage: vi.fn().mockResolvedValue(
      Result.ok({
        imageName: "otterstack-res-1",
        imageTag: "v1706745600000",
        durationMs: 12345,
        logs: ["build started", "build completed"],
      }),
    ),
    tagAsLatest: vi.fn().mockResolvedValue(Result.ok(undefined)),
    updateDeployment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("buildImage", () => {
  it("dispatches to the builder and records the image tag", async () => {
    const deps = createMockBuildDeps();

    const result = await buildImage(
      {
        deploymentId: "deploy-1",
        resourceId: "res-1",
        builder: "nixpacks",
        sourceDir: "/tmp/otterstack-builds/deploy-1",
        buildTimeEnv: { NODE_ENV: "production" },
        resource: mockResource,
        deploymentNumber: 42,
        force: false,
        existingImageTag: null,
      },
      deps,
    );

    expect(result.isOk()).toBe(true);
    const output = result.unwrap();
    expect(output.imageName).toBe("otterstack-res-1");
    expect(output.imageTag).toBe("v1706745600000");
    expect(output.fullImage).toBe("otterstack-res-1:v1706745600000");

    // Should call the builder
    expect(deps.buildImage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDir: "/tmp/otterstack-builds/deploy-1",
        resourceId: "res-1",
        deploymentNumber: 42,
        env: { NODE_ENV: "production" },
        startCommand: "node server.js",
        dockerfilePath: "Dockerfile",
        force: false,
      }),
    );

    // Should tag as latest
    expect(deps.tagAsLatest).toHaveBeenCalledWith("res-1", 42);

    // Should record image tag
    expect(deps.updateDeployment).toHaveBeenCalledWith("deploy-1", {
      imageTag: "v1706745600000",
      previousImageTag: undefined,
    });
  });

  it("handles force flag by passing it through to the builder", async () => {
    const deps = createMockBuildDeps();

    await buildImage(
      {
        deploymentId: "deploy-2",
        resourceId: "res-1",
        builder: "nixpacks",
        sourceDir: "/tmp/builds/deploy-2",
        buildTimeEnv: {},
        resource: mockResource,
        deploymentNumber: 43,
        force: true,
        existingImageTag: null,
      },
      deps,
    );

    expect(deps.buildImage).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
      }),
    );
  });
});
