import type { Node } from "@otterdeploy/docker";

import { describe, expect, test } from "vite-plus/test";

import { buildAvailabilityUpdate, matchSwarmNode } from "../node-match";

const node = (over: Partial<Node> = {}): Node => ({
  ID: "node-1",
  Version: { Index: 42 },
  Spec: { Role: "manager", Availability: "active" },
  Description: { Hostname: "prod-04" },
  ...over,
});

describe("matchSwarmNode", () => {
  test("matches by OS hostname first", () => {
    const nodes = [
      node({ ID: "a", Description: { Hostname: "prod-04" } }),
      node({ ID: "b", Description: { Hostname: "localhost" } }),
    ];
    // Bootstrap-style row: friendly name "localhost", real hostname "prod-04".
    expect(matchSwarmNode(nodes, { hostname: "prod-04", name: "localhost" })?.ID).toBe("a");
  });

  test("falls back to the friendly name when hostname doesn't match", () => {
    const nodes = [node({ ID: "b", Description: { Hostname: "worker-2" } })];
    expect(matchSwarmNode(nodes, { hostname: "something-else", name: "worker-2" })?.ID).toBe("b");
  });

  test("skips null/empty candidates and returns undefined on no match", () => {
    const nodes = [node()];
    expect(matchSwarmNode(nodes, { hostname: null, name: "" })).toBeUndefined();
    expect(matchSwarmNode(nodes, { hostname: "nope", name: "also-nope" })).toBeUndefined();
    expect(matchSwarmNode([], { hostname: "prod-04", name: null })).toBeUndefined();
  });
});

describe("buildAvailabilityUpdate", () => {
  test("carries version + existing spec fields and sets availability", () => {
    const n = node({
      Version: { Index: 7 },
      Spec: { Name: "prod-04", Labels: { zone: "a" }, Role: "manager", Availability: "active" },
    });
    expect(buildAvailabilityUpdate(n, "drain")).toEqual({
      version: 7,
      Name: "prod-04",
      Labels: { zone: "a" },
      Role: "manager",
      Availability: "drain",
    });
  });

  test("omits absent spec fields rather than sending undefined keys", () => {
    const n = node({ Version: { Index: 3 }, Spec: { Role: "worker" } });
    const update = buildAvailabilityUpdate(n, "pause");
    expect(update).toEqual({ version: 3, Role: "worker", Availability: "pause" });
    expect(update).not.toHaveProperty("Name");
    expect(update).not.toHaveProperty("Labels");
  });

  test("defaults version to 0 when the node has no version index", () => {
    const n = node({ Version: undefined, Spec: undefined });
    expect(buildAvailabilityUpdate(n, "active")).toEqual({ version: 0, Availability: "active" });
  });
});
