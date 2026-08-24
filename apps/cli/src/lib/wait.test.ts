import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import { evaluateDeployment, evaluateTasks } from "./wait";

// The client's row types, complete: fixtures are built whole (typed factories
// with defaults for every field) rather than partial objects cast into shape.
type Deployment = Parameters<typeof evaluateDeployment>[0];
type Task = Parameters<typeof evaluateTasks>[0][number];

function deployment(status: Deployment["status"], over: Partial<Deployment> = {}): Deployment {
  return {
    id: createId(ID_PREFIX.deployment),
    projectId: createId(ID_PREFIX.project),
    resourceId: createId(ID_PREFIX.resource),
    previewId: null,
    image: "registry.example.com/app:latest",
    reason: "create",
    status,
    errorMessage: null,
    taskCount: 1,
    failedTaskCount: 0,
    runningTaskCount: 0,
    restartCount: null,
    restartMaxAttempts: null,
    gitSha: null,
    gitRef: null,
    gitCommitMessage: null,
    gitCommitAuthor: null,
    gitCommitAuthorAvatar: null,
    sourceSha: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}
function task(state: Task["state"], over: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    slot: 1,
    label: "app.1",
    service: null,
    state,
    rawState: null,
    desiredState: null,
    nodeId: null,
    message: null,
    error: null,
    containerId: null,
    exitCode: null,
    timestamp: null,
    restarts: 0,
    ...over,
  };
}

describe("evaluateDeployment (git builds / redeploys)", () => {
  it("running → success", () => {
    expect(evaluateDeployment(deployment("running")).kind).toBe("success");
  });
  it("failed → failure carrying the error message", () => {
    const phase = evaluateDeployment(deployment("failed", { errorMessage: "build blew up" }));
    expect(phase).toMatchObject({ kind: "failure", errorMessage: "build blew up" });
  });
  it("crashed → failure", () => {
    expect(evaluateDeployment(deployment("crashed")).kind).toBe("failure");
  });
  it("building/pending → progress (keep waiting)", () => {
    expect(evaluateDeployment(deployment("building")).kind).toBe("progress");
    expect(evaluateDeployment(deployment("pending")).kind).toBe("progress");
  });
});

describe("evaluateTasks (image services, no deployment row)", () => {
  it("a running task → success", () => {
    expect(evaluateTasks([task("running")], 5_000).kind).toBe("success");
  });
  it("an errored task with nothing running → failure", () => {
    const phase = evaluateTasks([task("error", { error: "Exited (1)" })], 5_000);
    expect(phase).toMatchObject({ kind: "failure", errorMessage: "Exited (1)" });
  });
  it("running wins over a sibling errored task (rolling update)", () => {
    expect(evaluateTasks([task("error"), task("running")], 5_000).kind).toBe("success");
  });
  it("still building → progress", () => {
    expect(evaluateTasks([task("building")], 5_000).kind).toBe("progress");
  });
  it("no tasks before the grace window → progress", () => {
    expect(evaluateTasks([], 5_000).kind).toBe("progress");
  });
  it("no tasks past the grace window → failure (nothing scheduled)", () => {
    expect(evaluateTasks([], 130_000).kind).toBe("failure");
  });
});
