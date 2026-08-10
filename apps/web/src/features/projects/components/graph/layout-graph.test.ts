import type { Edge, Node } from "@xyflow/react";

import { describe, expect, it } from "vite-plus/test";

import {
  incrementalLayout,
  NODE_WIDTH,
  resolveAllOverlaps,
  resolveNewCollisions,
  topologySignature,
  type NodeSize,
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
const W = NODE_WIDTH;
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

  it("pins existing nodes when one is added, so they must not move", () => {
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
    // Two pinned cards dragged nearly on top of each other (they overlap, that
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

  // od-r96: a brand-new resource has no dependency edges yet (those only
  // appear once an env var references another resource), so dagre treats it
  // as its own disconnected component and racks those up left-to-right. On
  // a graph already spread wide by several earlier stacks, that landed the
  // new card thousands of px past the last one, off in empty space. These
  // pinned positions mirror what a real ~10-stack graph looks like once
  // dagre has spread its disconnected components out.
  it("places a brand-new, edge-less node near the pinned cluster instead of dagre's far-right slot", () => {
    const cached = new Map<string, XY>(
      Array.from({ length: 10 }, (_, i) => [
        `stack${i}`,
        { x: i * 468, y: i % 2 === 0 ? 40 : 400 },
      ]),
    );
    const pinnedNodes = [...cached.keys()].map(node);
    const result = incrementalLayout([...pinnedNodes, node("new")], noEdges, cached);

    // Every pinned card kept its exact cached spot.
    for (const [id, pos] of cached) expect(result.get(id)).toEqual(pos);

    const pinnedMaxX = Math.max(...[...cached.values()].map((p) => p.x)) + W;
    const pinnedMinX = Math.min(...[...cached.values()].map((p) => p.x));
    const pinnedMaxY = Math.max(...[...cached.values()].map((p) => p.y)) + H;
    const n = posOf(result, "new");
    // Lands within the pinned cluster's own x-span (not past its right edge
    // by more than one card + gap) and below it, not off past the last
    // dagre-invented column.
    expect(n.x).toBeGreaterThanOrEqual(pinnedMinX - W);
    expect(n.x).toBeLessThanOrEqual(pinnedMaxX + W);
    expect(n.y).toBeGreaterThanOrEqual(pinnedMaxY);
  });

  it("still places a new node wired to a pinned one near that neighbour, not the fresh row", () => {
    const cached = new Map<string, XY>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 2000, y: 0 }], // far off to the right, like a distant stack
    ]);
    const pinnedNodes = [node("a"), node("b")];
    const wiredEdge = [{ id: "e", source: "b", target: "new" }];
    const result = incrementalLayout([...pinnedNodes, node("new")], wiredEdge, cached);

    expect(result.get("a")).toEqual({ x: 0, y: 0 });
    expect(result.get("b")).toEqual({ x: 2000, y: 0 });
    // Wired to "b": should land near it, not near "a"'s side of the graph.
    const n = posOf(result, "new");
    expect(Math.abs(n.x - 2000)).toBeLessThan(Math.abs(n.x - 0));
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
    // between them: the only escape for the newcomer is downward.
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

describe("resolveNewCollisions: operator-placed nodes are fixed obstacles", () => {
  // The graph uses this with `isMovable = (id) => !dragged.has(id)`: a card the
  // operator dragged is never moved, but an auto-placed node is nudged clear of
  // it: the "drag stays put, auto-layout avoids you" contract.
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

// The last word on positions before React Flow renders them. Unlike
// incrementalLayout (which pins by design), this one answers to a single rule:
// when it returns, nothing overlaps. Whatever put the nodes where they were.
describe("resolveAllOverlaps", () => {
  it("separates two nodes that no layout pass ever compared (replayed graphLayout)", () => {
    // Exactly the shape of the bug: a persisted layout is replayed straight
    // into the render, so two saved spots can sit on top of each other and
    // neither is "new" for anyone to nudge.
    const positions = new Map<string, XY>([
      ["compose:it-tools-2", { x: 0, y: 0 }],
      ["compose:authentik", { x: 250, y: 10 }],
    ]);
    resolveAllOverlaps(positions, [node("compose:it-tools-2"), node("compose:authentik")]);
    const a = posOf(positions, "compose:it-tools-2");
    const b = posOf(positions, "compose:authentik");
    expect(intersects(a, b)).toBe(false);
  });

  it("anchors the top-left card and moves the ones after it", () => {
    const positions = new Map<string, XY>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 40, y: 20 }],
    ]);
    resolveAllOverlaps(positions, [node("a"), node("b")]);
    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
    expect(intersects(posOf(positions, "b"), { x: 0, y: 0 })).toBe(false);
  });

  it("is idempotent: a clean layout comes back untouched", () => {
    const clean = new Map<string, XY>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 900, y: 0 }],
      ["c", { x: 0, y: 700 }],
    ]);
    const nodes = [node("a"), node("b"), node("c")];
    const once = new Map(clean);
    resolveAllOverlaps(once, nodes);
    expect([...once]).toEqual([...clean]);
    resolveAllOverlaps(once, nodes);
    expect([...once]).toEqual([...clean]);
  });

  it("separates by MEASURED size, so a card taller than the estimate still clears", () => {
    // A stack group that grew well past the height estimate (extra services,
    // volume chips). Spaced so the estimate says "clear" and reality says
    // "overlapping": the case where the graph shipped a visible collision.
    const sizes: ReadonlyMap<string, NodeSize> = new Map([
      ["tall", { width: W, height: 900 }],
      ["below", { width: W, height: 220 }],
    ]);
    const positions = new Map<string, XY>([
      ["tall", { x: 0, y: 0 }],
      ["below", { x: 0, y: 400 }],
    ]);

    // Without the measurements the pass sees no overlap at all.
    const unmeasured = new Map(positions);
    resolveAllOverlaps(unmeasured, [node("tall"), node("below")]);
    expect(unmeasured.get("below")).toEqual({ x: 0, y: 400 });

    resolveAllOverlaps(positions, [node("tall"), node("below")], sizes);
    const tall = posOf(positions, "tall");
    const below = posOf(positions, "below");
    const clearVertically = below.y >= tall.y + 900 || tall.y >= below.y + 220;
    const clearHorizontally = below.x >= tall.x + W || tall.x >= below.x + W;
    expect(clearVertically || clearHorizontally).toBe(true);
    // It moved at all. The unmeasured pass above left it exactly where it was.
    expect(below).not.toEqual({ x: 0, y: 400 });
  });

  it("leaves nothing overlapping in a pile of cards stacked on one point", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const positions = new Map<string, XY>(ids.map((id, i) => [id, { x: i * 8, y: i * 4 }]));
    resolveAllOverlaps(positions, ids.map(node));
    for (const id of ids) {
      for (const other of ids) {
        if (id === other) continue;
        expect(intersects(posOf(positions, id), posOf(positions, other))).toBe(false);
      }
    }
  });
});
