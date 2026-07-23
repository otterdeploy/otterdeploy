import type { Edge, Node } from "@xyflow/react";

import { describe, expect, it } from "vite-plus/test";

import {
  incrementalLayout,
  resolveNewCollisions,
  topologySignature,
  type XY,
} from "./layout-graph";

const node = (id: string): Node => ({
  id,
  type: "resource",
  position: { x: 0, y: 0 },
  data: {},
});

const noEdges: Edge[] = [];

// Default resource card footprint the layout uses (NODE_WIDTH × NODE_HEIGHT).
const W = 420;
const H = 220;

// Strict geometric overlap (no gap) between two default-size cards at p and q.
const intersects = (p: XY, q: XY): boolean =>
  p.x < q.x + W && p.x + W > q.x && p.y < q.y + H && p.y + H > q.y;

// Read a required position out of a layout map, failing loudly if it's missing
// (keeps the assertions below `!`-free, which the repo lint forbids).
const posOf = (m: Map<string, XY>, id: string): XY => {
  const p = m.get(id);
  if (!p) throw new Error(`expected a position for "${id}"`);
  return p;
};

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
    const result = incrementalLayout([node("a"), node("b"), node("c")], noEdges, cached);
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

  it("never lets a new node land on top of a pinned one, and never moves the pinned ones", () => {
    // Two pinned cards dragged nearly on top of each other (they overlap — that
    // is the operator's choice and must be preserved). Adding a node drops its
    // ghost near the anchor, i.e. right into that pile.
    const cached = new Map<string, XY>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 24, y: 12 }],
    ]);
    const result = incrementalLayout([node("a"), node("b"), node("c")], noEdges, cached);
    // Pinned nodes are untouched.
    expect(result.get("a")).toEqual({ x: 0, y: 0 });
    expect(result.get("b")).toEqual({ x: 24, y: 12 });
    // The newcomer is nudged clear of every pinned card.
    const c = posOf(result, "c");
    expect(intersects(c, { x: 0, y: 0 })).toBe(false);
    expect(intersects(c, { x: 24, y: 12 })).toBe(false);
  });

  it("separates several new nodes from each other and from the pinned one", () => {
    const cached = new Map<string, XY>([["a", { x: 0, y: 0 }]]);
    const ids = ["b", "c", "d"];
    const result = incrementalLayout([node("a"), ...ids.map(node)], noEdges, cached);
    expect(result.get("a")).toEqual({ x: 0, y: 0 });
    for (const id of ids) {
      const p = posOf(result, id);
      expect(intersects(p, { x: 0, y: 0 })).toBe(false); // clear of pinned
      for (const other of ids) {
        if (other === id) continue;
        expect(intersects(p, posOf(result, other))).toBe(false); // clear of siblings
      }
    }
  });
});

describe("resolveNewCollisions", () => {
  const isNew = (id: string) => id === "c";

  it("nudges a new node off a single pinned overlap while pinning the rest", () => {
    const positions = new Map<string, XY>([
      ["a", { x: 0, y: 0 }],
      ["c", { x: 40, y: 20 }], // new, overlapping a
    ]);
    resolveNewCollisions(positions, [node("a"), node("c")], isNew);
    expect(positions.get("a")).toEqual({ x: 0, y: 0 }); // pinned untouched
    expect(intersects(posOf(positions, "c"), { x: 0, y: 0 })).toBe(false);
  });

  it("drops a horizontally boxed-in new node below the pile (phase-2 guarantee)", () => {
    // L and R are pinned, overlapping each other, so there is no clear spot
    // between them — the only escape for the newcomer is downward.
    const positions = new Map<string, XY>([
      ["L", { x: 0, y: 0 }],
      ["R", { x: 200, y: 0 }],
      ["c", { x: 100, y: 0 }], // new, boxed between the two
    ]);
    resolveNewCollisions(positions, [node("L"), node("R"), node("c")], isNew);
    expect(positions.get("L")).toEqual({ x: 0, y: 0 });
    expect(positions.get("R")).toEqual({ x: 200, y: 0 });
    const c = posOf(positions, "c");
    expect(intersects(c, { x: 0, y: 0 })).toBe(false);
    expect(intersects(c, { x: 200, y: 0 })).toBe(false);
    expect(c.y).toBeGreaterThan(0); // pushed down, not sideways
  });

  it("is a no-op when the new node already sits clear", () => {
    const positions = new Map<string, XY>([
      ["a", { x: 0, y: 0 }],
      ["c", { x: 900, y: 0 }],
    ]);
    resolveNewCollisions(positions, [node("a"), node("c")], isNew);
    expect(positions.get("c")).toEqual({ x: 900, y: 0 });
  });
});

describe("resolveNewCollisions — operator-placed nodes are fixed obstacles", () => {
  // The graph uses this with `isMovable = (id) => !dragged.has(id)`: a card the
  // operator dragged is never moved, but an auto-placed node is nudged clear of
  // it — the "drag stays put, auto-layout avoids you" contract.
  it("keeps a dragged card exactly where it is and moves the auto node off it", () => {
    const positions = new Map<string, XY>([
      ["dragged", { x: 100, y: 100 }],
      ["auto", { x: 140, y: 120 }],
    ]);
    // Only "auto" is movable.
    resolveNewCollisions(positions, [node("dragged"), node("auto")], (id) => id === "auto");
    expect(positions.get("dragged")).toEqual({ x: 100, y: 100 }); // untouched
    expect(intersects(posOf(positions, "auto"), { x: 100, y: 100 })).toBe(false);
  });

  it("leaves two operator-placed cards overlapping if that's where they were dropped", () => {
    const positions = new Map<string, XY>([
      ["a", { x: 100, y: 100 }],
      ["b", { x: 160, y: 140 }],
    ]);
    // Neither is movable (both operator-placed) → overlap is preserved.
    resolveNewCollisions(positions, [node("a"), node("b")], () => false);
    expect(positions.get("a")).toEqual({ x: 100, y: 100 });
    expect(positions.get("b")).toEqual({ x: 160, y: 140 });
  });
});

describe("topologySignature", () => {
  it("is identical regardless of node/edge order", () => {
    const a = topologySignature([node("x"), node("y")], [{ id: "e", source: "x", target: "y" }]);
    const b = topologySignature([node("y"), node("x")], [{ id: "e", source: "x", target: "y" }]);
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
