/**
 * After a failed deploy, the last good one is offered where the failure is,
 * not only in a history row's overflow menu.
 */
import { describe, expect, it, vi } from "vite-plus/test";

import type { DeploymentInfo } from "../deployment-cards";

vi.mock("@/shared/server/orpc", () => ({ orpc: {}, queryClient: {} }));

const { deploymentShortName, lastGoodDeployment } = await import("../rollback-dialog");

function deployment(id: string, status: DeploymentInfo["status"], image = `registry/web:${id}`) {
  const d: DeploymentInfo = {
    id,
    resourceId: "res_web",
    image,
    reason: "git-push",
    status,
    errorMessage: null,
    taskCount: 1,
    failedTaskCount: 0,
    runningTaskCount: 0,
    restartCount: null,
    restartMaxAttempts: null,
    gitSha: null,
    gitCommitMessage: null,
    gitCommitAuthor: null,
    gitCommitAuthorAvatar: null,
    completedAt: null,
    createdAt: "2026-10-07T12:00:00Z",
    updatedAt: "2026-10-07T12:00:00Z",
  };
  return d;
}

describe("lastGoodDeployment", () => {
  it("offers the newest deploy that can be rolled back to after a failure", () => {
    const history = [
      deployment("dep_2", "failed"),
      deployment("dep_1", "superseded"),
      deployment("dep_0", "superseded"),
    ];
    expect(lastGoodDeployment(deployment("dep_3", "failed"), history)?.id).toBe("dep_1");
    expect(lastGoodDeployment(deployment("dep_3", "crashed"), history)?.id).toBe("dep_1");
  });

  it("offers nothing when the latest deploy is fine, or nothing earlier worked", () => {
    expect(
      lastGoodDeployment(deployment("dep_3", "running"), [deployment("dep_1", "superseded")]),
    ).toBeUndefined();
    expect(
      lastGoodDeployment(deployment("dep_3", "failed"), [deployment("dep_2", "failed")]),
    ).toBeUndefined();
    // A git service's placeholder image was never built: nothing to go back to.
    expect(
      lastGoodDeployment(deployment("dep_3", "failed"), [
        deployment("dep_1", "superseded", "pending:initial"),
      ]),
    ).toBeUndefined();
    expect(lastGoodDeployment(null, [])).toBeUndefined();
  });
});

describe("deploymentShortName", () => {
  it("names a deploy by its commit, else its image tag", () => {
    expect(deploymentShortName({ ...deployment("d", "running"), gitSha: "abcdef1234" })).toBe(
      "abcdef1",
    );
    expect(deploymentShortName(deployment("d", "running", "ghcr.io/acme/web:v2"))).toBe("web:v2");
  });
});
