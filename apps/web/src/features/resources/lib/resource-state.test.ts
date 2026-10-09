import { describe, expect, it } from "vite-plus/test";

import { knownDeploymentStatus } from "./known-deployment";
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
  it("says why the runtime is failing, in the runtime's own words", () => {
    expect(
      serviceState({
        ...base,
        runtime: { status: "error", errorMessage: "no space left on device" },
        latestDeployment: { status: "running" },
      }),
    ).toEqual({ tone: "error", label: "error", why: "no space left on device" });
  });
  it("says what the graph says while the runtime loads", () => {
    // The graph node's pill is the latest deployment's status; the header
    // used to show nothing (or "not deployed") beside a green node.
    expect(
      serviceState({ ...base, runtime: undefined, latestDeployment: { status: "running" } }),
    ).toEqual({ tone: "running", label: "running", why: null });
  });
  it("stays unknown for a settled deploy the runtime has not confirmed", () => {
    expect(
      serviceState({ ...base, runtime: undefined, latestDeployment: { status: "superseded" } }),
    ).toBeNull();
  });
  it("never says 'not deployed' while the deployment history is still loading", () => {
    expect(serviceState({ ...base, runtime: undefined, latestDeployment: undefined })).toBeNull();
    expect(
      serviceState({ ...base, runtime: { status: "missing" }, latestDeployment: undefined }),
    ).toBeNull();
  });
  it("reads the runtime alone when the history is not known yet", () => {
    expect(
      serviceState({ ...base, runtime: { status: "running" }, latestDeployment: undefined }),
    ).toEqual({ tone: "running", label: "running", why: null });
  });
  it("is not-deployed when nothing ever ran", () => {
    expect(
      serviceState({ ...base, runtime: undefined, latestDeployment: { status: null } }),
    ).toEqual({ tone: "pending", label: "not deployed", why: null });
  });
});

describe("knownDeploymentStatus", () => {
  it("starts from the resource row (the graph's source) while the list loads", () => {
    expect(
      knownDeploymentStatus({ listed: undefined, listLoading: true, fromResource: "running" }),
    ).toEqual({ status: "running" });
  });
  it("prefers the live list once it has a row", () => {
    expect(
      knownDeploymentStatus({
        listed: { status: "building" },
        listLoading: false,
        fromResource: "running",
      }),
    ).toEqual({ status: "building" });
  });
  it("is unknown, not empty, while loading with nothing else to go on", () => {
    expect(
      knownDeploymentStatus({ listed: undefined, listLoading: true, fromResource: undefined }),
    ).toBeUndefined();
  });
  it("is empty once a loaded list says so", () => {
    expect(
      knownDeploymentStatus({ listed: undefined, listLoading: false, fromResource: undefined }),
    ).toEqual({ status: null });
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
      databaseState({
        runtime: { status: "error", health: null },
        latestDeploymentStatus: "running",
      }),
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
