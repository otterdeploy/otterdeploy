import type { CoordinateExtent, Node } from "@xyflow/react";

import { describe, expect, it } from "vite-plus/test";

import { applyBounds, computeGraphExtents } from "./graph-extent";

const node = (id: string, x: number, y: number): Node => ({
  id,
  position: { x, y },
  data: {},
  type: "resource",
});

describe("computeGraphExtents", () => {
  it("sizes the world around the laid-out graph", () => {
    const { nodeExtent, translateExtent } = computeGraphExtents([
      { x: 0, y: 0 },
      { x: 800, y: 400 },
    ]);
    const [[x0, y0], [x1, y1]] = nodeExtent;
    expect(x0).toBeLessThan(0);
    expect(y0).toBeLessThan(0);
    expect(x1).toBeGreaterThan(800);
    expect(y1).toBeGreaterThan(400);
    // Panning is always at least as permissive as node placement, otherwise a
    // card could sit somewhere the viewport can never reach.
    expect(translateExtent[0][0]).toBeLessThan(x0);
    expect(translateExtent[0][1]).toBeLessThan(y0);
    expect(translateExtent[1][0]).toBeGreaterThan(x1);
    expect(translateExtent[1][1]).toBeGreaterThan(y1);
  });

  it("gives a single node room to move", () => {
    const [[x0], [x1]] = computeGraphExtents([{ x: 0, y: 0 }]).nodeExtent;
    expect(x1 - x0).toBeGreaterThanOrEqual(1000);
  });

  it("falls back to a fixed world when there is nothing laid out", () => {
    const { nodeExtent } = computeGraphExtents([]);
    expect(nodeExtent[0][0]).toBeLessThan(0);
    expect(nodeExtent[1][0]).toBeGreaterThan(0);
  });
});

describe("applyBounds", () => {
  const extent: CoordinateExtent = [
    [-100, -100],
    [500, 500],
  ];

  it("pulls a stray saved position back inside the world", () => {
    // The case this exists for: an arrangement persisted before the canvas was
    // bounded, which otherwise drags fitView out to nothing on every load.
    const [pulled] = applyBounds([node("a", 99_999, -4_000)], extent, new Map());
    expect(pulled?.position).toEqual({ x: 500, y: -100 });
  });

  it("stamps measured sizes so the minimap can draw the node", () => {
    const measured = new Map([["a", { width: 420, height: 180 }]]);
    const [stamped] = applyBounds([node("a", 10, 10)], extent, measured);
    expect(stamped?.measured).toEqual({ width: 420, height: 180 });
  });

  it("keeps object identity when nothing changed", () => {
    // The graph leans on reference stability to keep re-renders to the dragged
    // card alone — a fresh object every frame would defeat the memoized nodes.
    const nodes = [node("a", 10, 10)];
    expect(applyBounds(nodes, extent, new Map())).toBe(nodes);
    expect(applyBounds(nodes, extent, new Map())[0]).toBe(nodes[0]);
  });
});
