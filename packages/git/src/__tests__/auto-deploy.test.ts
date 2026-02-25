import { describe, it, expect, vi } from "vitest";
import { resolveAutoDeployTargets, type AutoDeployMatch } from "../auto-deploy";
import type { WebhookEvent } from "../types";

vi.mock("@otterdeploy/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createPushEvent(
  overrides: Partial<WebhookEvent> = {},
): WebhookEvent {
  return {
    type: "push",
    repository: { owner: "owner", name: "repo", fullName: "owner/repo" },
    branch: "main",
    commitSha: "abc123",
    commitMessage: "feat: update",
    changedFiles: ["src/index.ts", "apps/api/server.ts"],
    pusher: { name: "user", email: "user@test.com" },
    deliveryId: "d-1",
    ...overrides,
  };
}

describe("resolveAutoDeployTargets", () => {
  it("matches repo+branch to resources", async () => {
    const match: AutoDeployMatch = {
      resourceId: "res-1",
      gitRepositoryId: "git-repo-1",
      environmentId: "env-1",
      projectId: "proj-1",
    };

    const result = await resolveAutoDeployTargets({
      event: createPushEvent(),
      findMatchingRepos: vi.fn().mockResolvedValue([match]),
      shouldDeploy: vi.fn().mockResolvedValue(true),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(match);
  });

  it("filters by shouldDeploy (watch paths)", async () => {
    const match1: AutoDeployMatch = {
      resourceId: "res-1",
      gitRepositoryId: "git-repo-1",
      environmentId: "env-1",
      projectId: "proj-1",
    };
    const match2: AutoDeployMatch = {
      resourceId: "res-2",
      gitRepositoryId: "git-repo-2",
      environmentId: "env-2",
      projectId: "proj-1",
    };

    const shouldDeploy = vi
      .fn()
      .mockResolvedValueOnce(true) // match1 passes
      .mockResolvedValueOnce(false); // match2 filtered out

    const result = await resolveAutoDeployTargets({
      event: createPushEvent(),
      findMatchingRepos: vi.fn().mockResolvedValue([match1, match2]),
      shouldDeploy,
    });

    expect(result).toHaveLength(1);
    expect(result[0].resourceId).toBe("res-1");
  });

  it("returns empty when no matching repositories", async () => {
    const result = await resolveAutoDeployTargets({
      event: createPushEvent(),
      findMatchingRepos: vi.fn().mockResolvedValue([]),
      shouldDeploy: vi.fn().mockResolvedValue(true),
    });

    expect(result).toHaveLength(0);
  });

  it("skips non-push events", async () => {
    const findMatchingRepos = vi.fn();
    const result = await resolveAutoDeployTargets({
      event: createPushEvent({ type: "pull_request" }),
      findMatchingRepos,
      shouldDeploy: vi.fn(),
    });

    expect(result).toHaveLength(0);
    expect(findMatchingRepos).not.toHaveBeenCalled();
  });
});
