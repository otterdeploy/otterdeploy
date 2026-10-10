import { describe, expect, it } from "vite-plus/test";

import { panelLocationFromView, panelTarget } from "./panel-location";

describe("panelLocationFromView", () => {
  it("reads the tab, the log source and the focused deployment off the route", () => {
    expect(panelLocationFromView([], {})).toEqual({
      tab: undefined,
      deployment: null,
      logSource: null,
    });
    expect(panelLocationFromView(["deployments"], { deploymentId: "dep_1" })).toEqual({
      tab: "deployments",
      deployment: "dep_1",
      logSource: null,
    });
    expect(panelLocationFromView(["logs", "build"], { deploymentSearch: "dep_2" })).toEqual({
      tab: "logs",
      deployment: "dep_2",
      logSource: "build",
    });
  });

  it("ignores a log source segment it does not know", () => {
    expect(panelLocationFromView(["logs", "nope"], {}).logSource).toBeNull();
  });
});

describe("panelTarget", () => {
  const here = { tab: "overview", deployment: null, logSource: null } as const;

  it("opens a plain tab at its own segment", () => {
    expect(panelTarget(here, { tab: "variables" })).toEqual({ kind: "tab", tab: "variables" });
    expect(panelTarget(here, { tab: "overview" })).toEqual({ kind: "tab", tab: "overview" });
  });

  it("expands a deployment at deployments/$deploymentId", () => {
    expect(panelTarget(here, { tab: "deployments", deployment: "dep_1" })).toEqual({
      kind: "deployment",
      deploymentId: "dep_1",
    });
  });

  it("collapses a deployment back to the deployments list", () => {
    const open = { tab: "deployments", deployment: "dep_1", logSource: null } as const;
    expect(panelTarget(open, { deployment: null })).toEqual({ kind: "tab", tab: "deployments" });
  });

  it("opens a deployment's build log, carrying which deployment", () => {
    expect(panelTarget(here, { tab: "logs", deployment: "dep_1", logSource: "build" })).toEqual({
      kind: "logs",
      source: "build",
      deployment: "dep_1",
    });
  });

  it("switches the log source in place and keeps the focused deployment", () => {
    const build = { tab: "logs", deployment: "dep_1", logSource: "build" } as const;
    expect(panelTarget(build, { logSource: "deploy" })).toEqual({
      kind: "logs",
      source: "deploy",
      deployment: "dep_1",
    });
    expect(panelTarget(build, { logSource: null })).toEqual({
      kind: "logs",
      source: "runtime",
      deployment: "dep_1",
    });
  });

  it("treats a focus change with no tab as staying on the current one", () => {
    const deployments = { tab: "deployments", deployment: null, logSource: null } as const;
    expect(panelTarget(deployments, { deployment: "dep_9" })).toEqual({
      kind: "deployment",
      deploymentId: "dep_9",
    });
  });

  it("falls back to overview when nothing names a tab", () => {
    expect(panelTarget({ tab: undefined, deployment: null, logSource: null }, {})).toEqual({
      kind: "tab",
      tab: "overview",
    });
  });
});
