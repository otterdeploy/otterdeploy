import { describe, expect, it } from "vite-plus/test";

import {
  databaseState,
  memberState,
  serviceState,
  stackState,
  taskWhy,
  toneOfMemberStatus,
  toneOfNodeStatus,
} from "./resource-state";

describe("taskWhy", () => {
  it("names the exit code and the restart count", () => {
    expect(
      taskWhy([
        { exitCode: 1, restarts: 1, desiredState: "shutdown" },
        { exitCode: 1, restarts: 1, desiredState: "shutdown" },
        { restarts: 0 },
      ]),
    ).toBe("exited 1 · 2 restarts");
  });
  it("falls back to the task error when nothing exited non-zero", () => {
    expect(taskWhy([{ error: "no suitable node" }])).toBe("no suitable node");
  });
  it("is null for a healthy set", () => {
    expect(taskWhy([{ exitCode: 0 }])).toBeNull();
  });
});

describe("serviceState", () => {
  const base = { pausedReplicas: null, tasks: [] };
  it("reads the runtime, never the schema row", () => {
    expect(
      serviceState({
        ...base,
        runtime: { status: "running", health: "unhealthy" },
        latestDeployment: { status: "running" },
      }),
    ).toEqual({ tone: "error", label: "unhealthy", why: "healthcheck failing" });
  });
  it("lets a deploy in flight own the state", () => {
    expect(
      serviceState({
        ...base,
        runtime: { status: "missing" },
        latestDeployment: { status: "building" },
      }),
    ).toEqual({ tone: "building", label: "building", why: null });
  });
  it("explains a crash with the tasks", () => {
    expect(
      serviceState({
        ...base,
        runtime: { status: "error" },
        latestDeployment: { status: "crashed" },
        tasks: [{ exitCode: 137, restarts: 3 }],
      }),
    ).toEqual({ tone: "error", label: "crashed", why: "exited 137 · 3 restarts" });
  });
  it("is paused when the operator paused it, whatever the container says", () => {
    expect(
      serviceState({
        pausedReplicas: 2,
        tasks: [],
        runtime: { status: "missing" },
        latestDeployment: { status: "paused" },
      }),
    ).toEqual({ tone: "paused", label: "paused", why: "resume restores 2 replicas" });
  });
  it("is null while the runtime is unknown for a deployed service", () => {
    expect(
      serviceState({ ...base, runtime: undefined, latestDeployment: { status: "running" } }),
    ).toBeNull();
  });
  it("is not-deployed when nothing ever ran", () => {
    expect(serviceState({ ...base, runtime: undefined, latestDeployment: { status: null } })).toEqual(
      { tone: "pending", label: "not deployed", why: null },
    );
  });
});

describe("stackState", () => {
  const st = (tone: "running" | "error" | "building" | "pending", label: string = tone) => ({
    tone,
    label,
    why: null,
  });
  it("names the members that are down", () => {
    expect(
      stackState([
        { name: "postiz-app", state: st("error", "crashed") },
        { name: "db", state: st("running") },
        { name: "redis", state: st("running") },
        { name: "temporal", state: st("error", "offline") },
      ]),
    ).toEqual({ tone: "error", label: "2/4 running", why: "postiz-app crashed, temporal offline" });
  });
  it("is building while any member is in flight and none is down", () => {
    expect(
      stackState([
        { name: "a", state: st("running") },
        { name: "b", state: st("building", "queued") },
      ]),
    ).toEqual({ tone: "building", label: "1/2 running", why: "b queued" });
  });
  it("is running only when every member is", () => {
    expect(stackState([{ name: "a", state: st("running") }])).toEqual({
      tone: "running",
      label: "1/1 running",
      why: null,
    });
  });
  it("is pending for a never-deployed stack", () => {
    expect(stackState([{ name: "a", state: st("pending") }])).toEqual({
      tone: "pending",
      label: "not deployed",
      why: null,
    });
  });
});

describe("memberState", () => {
  it("calls a failed from-source member a build failure", () => {
    expect(memberState("error", { hasBuild: true })).toEqual({
      tone: "error",
      label: "build failed",
      why: null,
    });
  });
  it("calls a failed image member crashed when the tasks say why", () => {
    expect(memberState("error", { tasks: [{ exitCode: 1 }] })).toEqual({
      tone: "error",
      label: "crashed",
      why: "exited 1",
    });
  });
  it("reads offline as down", () => {
    expect(toneOfMemberStatus("offline")).toBe("error");
    expect(memberState(undefined).label).toBe("offline");
  });
});

describe("databaseState", () => {
  // Regression: a staged database create has no container, so the draft the
  // graph panel builds from the manifest carries no `runtime`. Reading the
  // deploy-in-flight flag before this guard once took the whole graph route
  // down to the error boundary.
  it("is pending without a runtime", () => {
    expect(databaseState({ runtime: undefined }).tone).toBe("pending");
  });
  it("says unhealthy rather than running when the container is up but failing", () => {
    expect(databaseState({ runtime: { status: "running", health: "unhealthy" } }).label).toBe(
      "unhealthy",
    );
  });
  it("keeps a genuinely dead container an error, not a deploy", () => {
    expect(
      databaseState({ runtime: { status: "error", health: null }, latestDeploymentStatus: "running" }),
    ).toEqual({ tone: "error", label: "error", why: null });
  });
  it("is deploying when the container is gone during a deploy", () => {
    expect(
      databaseState({ runtime: { status: "missing" }, latestDeploymentStatus: "starting" }),
    ).toEqual({ tone: "building", label: "deploying", why: null });
  });
});

describe("toneOfNodeStatus", () => {
  it("folds queued into building", () => {
    expect(toneOfNodeStatus("queued")).toBe("building");
  });
});
