import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import { incrementalLayout, topologySignature, type XY } from "./layout-graph";

const node = (id: string): Node => ({
  id,
  type: "resource",
  position: { x: 0, y: 0 },
  data: {},
});

const noEdges: Edge[] = [];

describe("incrementalLayout", () => {
  it("lays out everything fresh when the cache is empty", () => {
    const result = incrementalLayout([node("a"), node("b")], noEdges, new Map());
    expect([...result.keys()].sort()).toEqual(["a", "b"]);
  });

  it("pins existing nodes when one is added — they must not move", () => {
    const cached = new Map<string, XY>([
      ["a", { x: 10, y: 20 }],
      ["b", { x: 500, y: 20 }],
    ]);
    const result = incrementalLayout(
      [node("a"), node("b"), node("c")],
      noEdges,
      cached,
    );
    // Existing nodes keep their exact cached spot.
    expect(result.get("a")).toEqual({ x: 10, y: 20 });
    expect(result.get("b")).toEqual({ x: 500, y: 20 });
    // The new node is placed (somewhere) rather than dropped.
    expect(result.get("c")).toBeDefined();
  });

  it("keeps survivors put when a node is removed", () => {
    const cached = new Map<string, XY>([
      ["a", { x: 10, y: 20 }],
      ["b", { x: 500, y: 20 }],
      ["c", { x: 1000, y: 20 }],
    ]);
    const result = incrementalLayout([node("a"), node("b")], noEdges, cached);
    expect(result.get("a")).toEqual({ x: 10, y: 20 });
    expect(result.get("b")).toEqual({ x: 500, y: 20 });
    expect(result.has("c")).toBe(false);
  });
});

describe("topologySignature", () => {
  it("is identical regardless of node/edge order", () => {
    const a = topologySignature([node("x"), node("y")], [
      { id: "e", source: "x", target: "y" },
    ]);
    const b = topologySignature([node("y"), node("x")], [
      { id: "e", source: "x", target: "y" },
    ]);
    expect(a).toBe(b);
  });

  it("changes when a node is added or removed", () => {
    const one = topologySignature([node("x")], noEdges);
    const two = topologySignature([node("x"), node("y")], noEdges);
    expect(one).not.toBe(two);
  });

  it("is stable when only node data changes (same id set)", () => {
    const before = topologySignature([{ ...node("x"), data: { status: "running" } }], noEdges);
    const after = topologySignature([{ ...node("x"), data: { status: "error" } }], noEdges);
    expect(before).toBe(after);
  });
});
