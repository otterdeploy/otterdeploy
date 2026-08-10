/**
 * Card geometry for the resource graph: how big a node is, and how to push two
 * of them apart. Split out of layout-graph.ts, which is about dagre. This is
 * about the guarantee that comes after it, that no two cards ever overlap.
 */

import type { Node } from "@xyflow/react";

// Match the rendered ResourceNode card so dagre's overlap detection is
// accurate. Width matches `w-92` (368px) plus the implicit padding; height is
// a rough average since cards grow with replicas/mounts trays.
// Exported so the collision/extent code and the tests measure the same card
// instead of each carrying their own copy of the number.
export const NODE_WIDTH = 388;
const NODE_HEIGHT = 220;

// Breathing room enforced by the collision pass when it nudges a newly-placed
// node off a pinned one. Tighter than dagre's nodesep so a nudge lands the card
// adjacent rather than a full rank away, but wide enough to read as separate.
const NODE_GAP = 56;

// A compose stack renders as a group: a header plus one card per service, so
// it's far taller than a single resource card. Estimate its height from the
// service count so dagre doesn't overlap it with the node below. Keep roughly
// in sync with ComposeGroupNode's card metrics.
const GROUP_HEADER_H = 96;
const GROUP_CARD_H = 104;

export function nodeHeight(node: Node): number {
  // `Node["data"]` is already `Record<string, unknown>`. Read the two fields
  // straight off it and narrow them, no cast to a shape we're only guessing at.
  const { kind, services } = node.data;
  if (kind === "compose") {
    const count = Array.isArray(services) ? services.length : 0;
    return GROUP_HEADER_H + Math.max(count, 1) * GROUP_CARD_H;
  }
  return NODE_HEIGHT;
}

export interface XY {
  x: number;
  y: number;
}

export interface NodeSize {
  width: number;
  height: number;
}

/** Sizes React Flow measured after mount, keyed by node id. Optional
 *  everywhere: dagre has to place a node before it has ever been rendered, so
 *  the estimates above are the fallback, but once a real size exists it wins,
 *  because the estimates are averages and a card that grew (volume chips, a
 *  replicas tray) is exactly the card that ends up overlapping its neighbour. */
export type SizeLookup = ReadonlyMap<string, NodeSize> | undefined;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectFor(node: Node, pos: XY, sizes?: SizeLookup): Rect {
  const measured = sizes?.get(node.id);
  return {
    x: pos.x,
    y: pos.y,
    w: measured?.width ?? NODE_WIDTH,
    h: measured?.height ?? nodeHeight(node),
  };
}

/** Smallest rect enclosing every rect in the list, or null for an empty list. */
export function boundingBoxOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}/**
 * Minimum-translation vector that pushes `a` clear of `b` (both inflated by
 * `gap`), or null when they don't overlap. Only `a` is ever moved. The caller
 * treats `b` as an immovable obstacle. Resolves along the axis of least
 * penetration so the nudge is as small as possible.
 */
function separationVector(a: Rect, b: Rect, gap: number): XY | null {
  // How far to move `a` in each direction to just clear `b` plus the gap.
  const penLeft = a.x + a.w + gap - b.x; // move left by this
  const penRight = b.x + b.w + gap - a.x; // move right by this
  const penUp = a.y + a.h + gap - b.y; // move up by this
  const penDown = b.y + b.h + gap - a.y; // move down by this
  // Any non-positive penetration ⇒ already clear on that side ⇒ no overlap.
  if (penLeft <= 0 || penRight <= 0 || penUp <= 0 || penDown <= 0) return null;

  const minX = Math.min(penLeft, penRight);
  const minY = Math.min(penUp, penDown);
  if (minX < minY) {
    return { x: penLeft < penRight ? -penLeft : penRight, y: 0 };
  }
  return { x: 0, y: penUp < penDown ? -penUp : penDown };
}

/**
 * Nudge newly-placed nodes so none overlaps a pinned node (or an earlier new
 * node). Pinned nodes are NEVER moved. That's the whole point of the
 * incremental layout, so collision is resolved by moving only the newcomers.
 *
 * Greedy insertion in reading order (top-to-bottom, then left-to-right): each
 * new node is separated against every already-committed rect, then itself
 * becomes an obstacle for the ones after it. This keeps dagre's relative
 * arrangement of the new cluster intact while guaranteeing no card lands on top
 * of another. Mutates `positions` in place.
 */
export function resolveNewCollisions(
  positions: Map<string, XY>,
  nodes: Node[],
  isNew: (id: string) => boolean,
  sizes?: SizeLookup,
): void {
  // Every pinned node is a fixed obstacle from the start. New nodes are the
  // movable set. Resolved greedily in reading order (top-to-bottom, then
  // left-to-right) so dagre's relative arrangement is disturbed as little as
  // possible. Snapshot each node's rect up front so the loop below never has to
  // re-read (and re-narrow) the positions map.
  const obstacles: Rect[] = [];
  const movable: { id: string; rect: Rect }[] = [];
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    if (isNew(n.id)) movable.push({ id: n.id, rect: rectFor(n, p, sizes) });
    else obstacles.push(rectFor(n, p, sizes));
  }
  movable.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

  for (const m of movable) {
    let rect = m.rect;

    // Phase 1: minimal least-penetration nudges. Keeps the card near dagre's
    // spot (and in its rank band) while sliding it off its neighbours. Resolves
    // essentially every real case in a couple of passes.
    for (let iter = 0; iter < 32; iter++) {
      let moved = false;
      for (const o of obstacles) {
        const sep = separationVector(rect, o, NODE_GAP);
        if (sep) {
          rect = { x: rect.x + sep.x, y: rect.y + sep.y, w: rect.w, h: rect.h };
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Phase 2: guarantee. If a card is boxed in on opposing sides, phase 1 can
    // oscillate without ever clearing. Drop it straight below the lowest card it
    // still conflicts with; `y` increases every pass so this terminates, and the
    // card lands in guaranteed-free space beneath the pile.
    for (let iter = 0; iter <= obstacles.length; iter++) {
      let lowestBottom = -Infinity;
      for (const o of obstacles) {
        if (separationVector(rect, o, NODE_GAP)) {
          lowestBottom = Math.max(lowestBottom, o.y + o.h);
        }
      }
      if (lowestBottom === -Infinity) break;
      rect = { ...rect, y: lowestBottom + NODE_GAP };
    }

    positions.set(m.id, { x: rect.x, y: rect.y });
    obstacles.push(rect);
  }
}

/**
 * Guarantee: after this runs, NO two nodes in `positions` overlap.
 *
 * `resolveNewCollisions` only ever separates the nodes it's told are new, which
 * covers dagre's own output and a fresh drop, but a node's final position on
 * the canvas can come from three other places that never went through it:
 *
 *   - the project's PERSISTED layout (`project.graphLayout`), replayed on load
 *     straight into the dragged map. A name that's been reused (deploy a
 *     template, delete it, deploy it again) inherits the old node's saved spot,
 *     which nothing checks against the graph that exists now.
 *   - a card that GREW after it was placed. A stack gaining a service, a
 *     volume chip wrapping a row. Its neighbour was cleared against the old,
 *     smaller estimate and is now underneath it.
 *   - dagre estimates generally: they're averages, not measurements.
 *
 * So the last word on positions is this pass, over every node, using measured
 * sizes where React Flow has reported them. Reading order (top-to-bottom, then
 * left-to-right) decides who yields: the top-left-most card never moves and
 * each one after it is nudged clear of everything already committed. That makes
 * it deterministic AND idempotent: a layout with no overlaps comes back byte
 * for byte identical, so this is free on every render that didn't need it.
 */
export function resolveAllOverlaps(
  positions: Map<string, XY>,
  nodes: Node[],
  sizes?: SizeLookup,
): void {
  resolveNewCollisions(positions, nodes, () => true, sizes);
}