import { describe, expect, it } from "vite-plus/test";

import type { Task } from "@/features/projects/components/graph/build-live-nodes";

import { composeStatusLookup, type StackChildRow } from "./use-compose-service-status";

const STACK_ID = "res_stack";
const noTasks = new Map<string, Task[]>();

/**
 * The shape the reconciler actually produces: `serviceName` is the runtime name
 * (`composeSwarmServiceName(stack, key)`), while the resource NAME is
 * collision-suffixed by pickResourceName and matches the declared compose key
 * for essentially no stack.
 */
function child(over: Partial<StackChildRow> = {}): StackChildRow {
  return {
    type: "service",
    stackId: STACK_ID,
    resourceId: "res_child",
    serviceName: "store-it-tools-2_it-tools",
    latestDeploymentStatus: "running",
    ...over,
  };
}

describe("composeStatusLookup", () => {
  it("resolves a child by its runtime name, not the collision-suffixed resource name", () => {
    const at = composeStatusLookup({
      stackResourceId: STACK_ID,
      // The child's own deployment says it failed; the stack's says building.
      // Reading the child is the whole point: the panel must not answer with
      // the stack's state when a real child exists.
      resources: [child({ latestDeploymentStatus: "failed" })],
      tasksByResourceId: noTasks,
      base: "building",
    });
    expect(at("store-it-tools-2_it-tools")).toBe("error");
  });

  it("falls back to the stack's own state only when no child exists yet", () => {
    const at = composeStatusLookup({
      stackResourceId: STACK_ID,
      resources: [],
      tasksByResourceId: noTasks,
      base: "error",
    });
    expect(at("store-it-tools-2_it-tools")).toBe("error");
  });

  it("never claims a member is running just because the stack's deploy row is", () => {
    // The stack rolled out, this member has no live task → honest "offline".
    const at = composeStatusLookup({
      stackResourceId: STACK_ID,
      resources: [child({ latestDeploymentStatus: "running" })],
      tasksByResourceId: noTasks,
      base: undefined,
    });
    expect(at("store-it-tools-2_it-tools")).toBe("offline");
  });

  it("prefers live tasks over the deployment row", () => {
    const at = composeStatusLookup({
      stackResourceId: STACK_ID,
      resources: [child({ latestDeploymentStatus: "running" })],
      tasksByResourceId: new Map([
        ["res_child", [{ label: "t1", service: null, state: "running" }]],
      ]),
      base: undefined,
    });
    expect(at("store-it-tools-2_it-tools")).toBe("running");
  });

  it("ignores services owned by a different stack", () => {
    const at = composeStatusLookup({
      stackResourceId: STACK_ID,
      resources: [child({ stackId: "res_other", latestDeploymentStatus: "running" })],
      tasksByResourceId: noTasks,
      base: "error",
    });
    expect(at("store-it-tools-2_it-tools")).toBe("error");
  });
});
