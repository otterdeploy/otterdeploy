import { describe, expect, test } from "vite-plus/test";

import { isSwarmNodeId, placementFor, placementSpread, withPlacement } from "./placement";

const NODE = "m3k7bjlt8ly8ps5jblocjcqla";

describe("isSwarmNodeId", () => {
  test("accepts a real swarm node id", () => {
    expect(isSwarmNodeId(NODE)).toBe(true);
  });

  test("rejects the things that get passed here by mistake", () => {
    expect(isSwarmNodeId("")).toBe(false);
    expect(isSwarmNodeId(null)).toBe(false);
    expect(isSwarmNodeId(undefined)).toBe(false);
    // A hostname, not unique, and the reason we constrain on id.
    expect(isSwarmNodeId("ubuntu-4gb-nbg1-1")).toBe(false);
    // An otterdeploy server row id, which is not a swarm id.
    expect(isSwarmNodeId("server_dpwvw00dn0yi9kqclvcnojv5")).toBe(false);
    expect(isSwarmNodeId("10.0.0.4")).toBe(false);
  });
});

describe("placementFor", () => {
  test("emits a node.id constraint", () => {
    expect(placementFor(NODE)).toEqual({ Constraints: [`node.id == ${NODE}`] });
  });

  test("returns null rather than an empty Constraints array", () => {
    // An empty array is not the same as an absent key to swarm.
    expect(placementFor(undefined)).toBeNull();
    expect(placementFor("")).toBeNull();
  });

  test("a malformed target is dropped, not emitted", () => {
    // Swarm rejects a bad constraint and fails the whole deploy. An unplaced
    // service is strictly better than one that can't be created.
    expect(placementFor("not a node id")).toBeNull();
  });
});

describe("withPlacement", () => {
  const template = { ContainerSpec: { Image: "nginx" }, ForceUpdate: 1 };

  test("adds Placement when pinned, preserving the rest of the template", () => {
    const out = withPlacement(template, NODE);
    expect(out.Placement).toEqual({ Constraints: [`node.id == ${NODE}`] });
    expect(out.ContainerSpec).toEqual({ Image: "nginx" });
    expect(out.ForceUpdate).toBe(1);
  });

  test("leaves the template completely untouched when unpinned", () => {
    expect(withPlacement(template, null)).toEqual(template);
    expect("Placement" in withPlacement(template, null)).toBe(false);
  });

  test("does not mutate the input", () => {
    const original = { ContainerSpec: { Image: "nginx" } };
    withPlacement(original, NODE);
    expect("Placement" in original).toBe(false);
  });
});

describe("placementSpread", () => {
  test("spreads a Placement key when pinned", () => {
    expect(placementSpread(NODE)).toEqual({ Placement: { Constraints: [`node.id == ${NODE}`] } });
  });

  test("spreads nothing at all when unpinned", () => {
    // Must be an empty object, not { Placement: undefined }. Swarm treats a
    // present-but-empty key differently from an absent one.
    expect(placementSpread(null)).toEqual({});
    expect("Placement" in placementSpread(null)).toBe(false);
  });
});
