import { useCallback, useMemo, useState, type RefObject } from "react";

import type { CoordinateExtent, Node, NodeChange } from "@xyflow/react";

import { CARD_W, computeLaidOutNodes } from "./laid-out-nodes";

interface XY {
  x: number;
  y: number;
}

/**
 * Bounds for the graph canvas.
 *
 * The canvas used to be unbounded in both senses: nothing stopped a card being
 * dragged arbitrarily far, and `onNodeDragStop` persists every drop to
 * `project.graphLayout`. So one careless fling was saved forever, and because
 * `fitView` has to frame every node, the next load collapsed the whole graph
 * into a corner of specks with no way to find the stray one.
 *
 * The world is sized from the laid-out graph rather than hard-coded, so a
 * four-node project doesn't rattle around inside a huge void and a forty-node
 * one doesn't hit a wall. Panning gets a slightly larger box than nodes, so you
 * can always scroll far enough to see the outermost card with breathing room.
 */

/** Approximate card height; only used to keep the far edge off a card's corner. */
const CARD_H = 200;
/** Slack around the laid-out graph that cards may be dragged into. */
const NODE_MARGIN = 900;
/** Extra room the viewport may pan into beyond the node area. */
const PAN_MARGIN = 600;
/** Floor, so a single-node project still has somewhere to move. */
const MIN_SPAN = 1600;

export interface GraphExtents {
  nodeExtent: CoordinateExtent;
  translateExtent: CoordinateExtent;
}

function expandToMinimum(min: number, max: number): [number, number] {
  const span = max - min;
  if (span >= MIN_SPAN) return [min, max];
  const pad = (MIN_SPAN - span) / 2;
  return [min - pad, max + pad];
}

/**
 * `nodeExtent` clamps a node's *position*, which React Flow treats as its
 * top-left corner, so the far edges subtract a card so a card dropped at the
 * limit still sits fully inside the world rather than hanging out of it.
 */
export function computeGraphExtents(positions: Iterable<XY>): GraphExtents {
  const points = [...positions];
  if (points.length === 0) {
    const fallback: CoordinateExtent = [
      [-MIN_SPAN, -MIN_SPAN],
      [MIN_SPAN, MIN_SPAN],
    ];
    return { nodeExtent: fallback, translateExtent: fallback };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + CARD_W);
    maxY = Math.max(maxY, p.y + CARD_H);
  }

  const [x0, x1] = expandToMinimum(minX - NODE_MARGIN, maxX + NODE_MARGIN);
  const [y0, y1] = expandToMinimum(minY - NODE_MARGIN, maxY + NODE_MARGIN);

  return {
    nodeExtent: [
      [x0, y0],
      [x1 - CARD_W, y1 - CARD_H],
    ],
    translateExtent: [
      [x0 - PAN_MARGIN, y0 - PAN_MARGIN],
      [x1 + PAN_MARGIN, y1 + PAN_MARGIN],
    ],
  };
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Pulls saved positions back inside the world, and stamps each node with the
 * size React Flow measured for it.
 *
 * Two jobs in one pass so a node keeps its object identity unless something
 * about it actually changed. The graph leans on reference stability to keep
 * re-renders to the dragged card alone (see laid-out-nodes.ts).
 *
 * Positions saved before the canvas was bounded can sit anywhere, and
 * `nodeExtent` only clamps a drag in progress; without the clamp an existing
 * stray stays stray and keeps dragging `fitView` out with it. The sizes matter
 * because MiniMap skips any node it can't measure, and since this graph is
 * controlled, the only way a size reaches the node objects is for us to put it
 * there.
 */
export function applyBounds(
  nodes: Node[],
  extent: CoordinateExtent,
  measured: ReadonlyMap<string, Size>,
): Node[] {
  const [[x0, y0], [x1, y1]] = extent;
  let changed = false;
  const out = nodes.map((node) => {
    const x = Math.min(Math.max(node.position.x, x0), x1);
    const y = Math.min(Math.max(node.position.y, y0), y1);
    const size = node.measured ?? measured.get(node.id);
    const moved = x !== node.position.x || y !== node.position.y;
    const resized = size !== undefined && size !== node.measured;
    if (!moved && !resized) return node;
    changed = true;
    return {
      ...node,
      position: moved ? { x, y } : node.position,
      ...(resized ? { measured: size } : {}),
    };
  });
  return changed ? out : nodes;
}

/**
 * Remembers the dimensions React Flow reports. `onNodesChange` previously threw
 * `dimensions` changes away and kept only positions, so no node ever carried a
 * size, which is why the minimap rendered an empty rectangle.
 *
 * Called by GraphCanvas rather than by useBoundedGraph, because the layout pass
 * needs these too: real sizes are what let the overlap guarantee separate the
 * cards that are actually on screen instead of dagre's estimates of them.
 */
export function useNodeDimensions() {
  const [measured, setMeasured] = useState<ReadonlyMap<string, Size>>(() => new Map());
  const capture = useCallback((changes: NodeChange[]) => {
    setMeasured((prev) => {
      let next: Map<string, Size> | null = null;
      for (const c of changes) {
        if (c.type !== "dimensions" || !c.dimensions) continue;
        const cur = prev.get(c.id);
        if (cur && cur.width === c.dimensions.width && cur.height === c.dimensions.height) continue;
        next ??= new Map(prev);
        next.set(c.id, { width: c.dimensions.width, height: c.dimensions.height });
      }
      return next ?? prev;
    });
  }, []);
  return { measured, capture };
}

/**
 * The bounded node list plus the extents React Flow needs, in one hook so the
 * route file stays under its function-length cap.
 *
 * Keyed on the layout signature, never on live node positions: sizing the world
 * from where cards currently sit would let the bounds grow every time someone
 * dragged toward the edge, which is exactly how the canvas ended up unbounded.
 */
function useBoundedGraph(
  nodes: Node[],
  layoutCache: RefObject<{ sig: string; positions: Map<string, { x: number; y: number }> }>,
  measured: ReadonlyMap<string, Size>,
): GraphExtents & { nodes: Node[] } {
  const sig = layoutCache.current.sig;
  const extents = useMemo(
    () => computeGraphExtents(layoutCache.current.positions.values()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topology-keyed on purpose
    [sig],
  );
  const bounded = useMemo(
    () => applyBounds(nodes, extents.nodeExtent, measured),
    [nodes, extents.nodeExtent, measured],
  );
  return { ...extents, nodes: bounded };
}

/**
 * Everything between "here are the nodes" and "here is what React Flow
 * renders": measure, place (dagre + drags + the overlap guarantee), bound.
 *
 * One hook rather than three calls in GraphCanvas because the order between
 * them matters and is easy to get wrong. The measured sizes have to reach the
 * LAYOUT, not just the minimap, or the overlap pass separates estimates instead
 * of cards. It also keeps the route component under its line cap.
 */
export function usePlacedNodes(
  args: Omit<Parameters<typeof computeLaidOutNodes>[0], "measured"> & {
    layoutCache: RefObject<{ sig: string; positions: Map<string, XY> }>;
  },
): GraphExtents & {
  nodes: Node[];
  measured: ReadonlyMap<string, Size>;
  captureDimensions: (changes: NodeChange[]) => void;
} {
  const { measured, capture } = useNodeDimensions();
  const { dragging, dragged, liveNodes, liveEdges, renderedNodesRef, layoutCache } = args;

  // Reads/writes the render-cache refs during render on purpose. Mid-drag it
  // must return the exact set last rendered (no flicker) and it accumulates
  // dagre positions across renders; promoting either to state reintroduces the
  // flicker/jitter the cache prevents. See laid-out-nodes.ts.
  /* oxlint-disable react-hooks-js/refs -- deliberate render cache (anti-flicker) */
  const laidOut = useMemo(
    () =>
      computeLaidOutNodes({
        dragging,
        dragged,
        liveNodes,
        liveEdges,
        renderedNodesRef,
        layoutCache,
        measured,
      }),
    [dragging, dragged, liveNodes, liveEdges, renderedNodesRef, layoutCache, measured],
  );
  /* oxlint-enable react-hooks-js/refs */

  const bounded = useBoundedGraph(laidOut, layoutCache, measured);
  return { ...bounded, measured, captureDimensions: capture };
}
