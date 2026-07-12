import { describe, expect, it } from "vite-plus/test";

import { evaluateDeployment, evaluateTasks } from "./wait";

// Minimal structural stand-ins for the client's row types.
type Deployment = Parameters<typeof evaluateDeployment>[0];
type Task = Parameters<typeof evaluateTasks>[0][number];

function deployment(status: string, over: Partial<Deployment> = {}): Deployment {
  return { id: "deployment_x", status, errorMessage: null, ...over } as Deployment;
}
function task(state: "running" | "building" | "error", over: Partial<Task> = {}): Task {
  return { state, error: null, message: null, ...over } as Task;
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
