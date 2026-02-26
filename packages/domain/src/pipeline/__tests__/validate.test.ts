import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "better-result";

import { validateDeployment } from "../validate";
import type { PipelineDeps, DeploymentContext } from "../types";

function createMockDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    getDeployment: vi.fn().mockResolvedValue({
      id: "deploy-1",
      organizationId: "org-1",
      projectId: "proj-1",
      environmentId: "env-1",
      resourceId: "res-1",
      status: "queued",
      source: "manual",
      builder: "nixpacks",
      imageTag: null,
      previousImageTag: null,
      gitRef: "main",
      gitCommitSha: null,
      triggeredBy: "user-1",
      metadata: {},
    }),
    getResource: vi.fn().mockResolvedValue({
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
      startCommand: null,
      preDeployCommand: null,
      restartPolicy: "ALWAYS",
      restartPolicyMaxRetries: null,
      builder: "nixpacks",
      dockerfilePath: "Dockerfile",
      buildCommand: null,
      serverId: null,
    }),
    getProject: vi.fn().mockResolvedValue({
      id: "proj-1",
      name: "My Project",
      slug: "my-project",
      baseDomain: "example.com",
      organizationId: "org-1",
    }),
    getEnvironment: vi.fn().mockResolvedValue({
      id: "env-1",
      name: "production",
      slug: "production",
      projectId: "proj-1",
    }),
    getGitRepository: vi.fn().mockResolvedValue({
      owner: "acme",
      name: "web-app",
      branch: "main",
      rootDirectory: null,
      gitProviderId: "gp-1",
    }),
    getActiveDeploymentsForResource: vi.fn().mockResolvedValue([]),
    getResourceDomains: vi.fn().mockResolvedValue([]),
    getResourcePort: vi.fn().mockResolvedValue(3000),
    transitionTo: vi.fn().mockResolvedValue(Result.ok(undefined)),
    updateDeployment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createContext(overrides: Partial<DeploymentContext> = {}): DeploymentContext {
  return {
    deploymentId: "deploy-1",
    organizationId: "org-1",
    projectId: "proj-1",
    environmentId: "env-1",
    resourceId: "res-1",
    actorUserId: "user-1",
    source: "manual",
    ...overrides,
  };
}

describe("validateDeployment", () => {
  it("returns resource config on successful validation", async () => {
    const deps = createMockDeps();
    const ctx = createContext();

    const result = await validateDeployment(ctx, deps);

    expect(result.isOk()).toBe(true);
    const output = result.unwrap();
    expect(output.resource.id).toBe("res-1");
    expect(output.resource.name).toBe("web-app");
    expect(output.project.slug).toBe("my-project");
    expect(output.environment.name).toBe("production");
    expect(output.builder).toBe("nixpacks");
    expect(output.gitRepo).not.toBeNull();
    expect(output.gitRepo?.owner).toBe("acme");

    // Should transition to building
    expect(deps.transitionTo).toHaveBeenCalledWith("deploy-1", "building", {
      actor: "user-1",
      reason: "Build started",
    });
  });

  it("returns error when another deployment is active for the resource", async () => {
    const deps = createMockDeps({
      getActiveDeploymentsForResource: vi.fn().mockResolvedValue([
        { id: "deploy-0", status: "deploying" },
      ]),
    });
    const ctx = createContext();

    const result = await validateDeployment(ctx, deps);

    expect(result.isErr()).toBe(true);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toContain("Conflicting deployment");
    expect((result.error as Error).message).toContain("deploy-0");
  });

  it("returns error when deployment is not found", async () => {
    const deps = createMockDeps({
      getDeployment: vi.fn().mockResolvedValue(null),
    });
    const ctx = createContext();

    const result = await validateDeployment(ctx, deps);

    expect(result.isErr()).toBe(true);
    expect((result.error as Error).message).toContain("Deployment not found");
  });
});
