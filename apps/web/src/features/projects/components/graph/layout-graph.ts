/**
 * Dagre auto-layout for the resource graph. Pure function: takes the nodes +
 * edges, returns nodes with absolute positions. Top-to-bottom rank so routes
 * (later) sit above services, services above databases — same visual as the
 * old hand-positioned mock.
 */

import type { Edge, Node } from "@xyflow/react";

import dagre from "dagre";

// Match the rendered ResourceNode card so dagre's overlap detection is
// accurate. Width matches `w-92` (368px) plus the implicit padding; height is
// a rough average since cards grow with replicas/mounts trays.
const NODE_WIDTH = 420;
const NODE_HEIGHT = 220;
const RANK_SEP = 140;
const NODE_SEP = 80;

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

function nodeHeight(node: Node): number {
  const data = node.data as { kind?: unknown; services?: unknown };
  if (data?.kind === "compose") {
    const count = Array.isArray(data.services) ? data.services.length : 0;
    return GROUP_HEADER_H + Math.max(count, 1) * GROUP_CARD_H;
  }
  return NODE_HEIGHT;
}

export interface XY {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectFor(node: Node, pos: XY): Rect {
  return { x: pos.x, y: pos.y, w: NODE_WIDTH, h: nodeHeight(node) };
}

/**
 * Minimum-translation vector that pushes `a` clear of `b` (both inflated by
 * `gap`), or null when they don't overlap. Only `a` is ever moved — the caller
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
 * node). Pinned nodes are NEVER moved — that's the whole point of the
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
): void {
  // Every pinned node is a fixed obstacle from the start. New nodes are the
  // movable set — resolved greedily in reading order (top-to-bottom, then
  // left-to-right) so dagre's relative arrangement is disturbed as little as
  // possible. Snapshot each node's rect up front so the loop below never has to
  // re-read (and re-narrow) the positions map.
  const obstacles: Rect[] = [];
  const movable: { id: string; rect: Rect }[] = [];
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    if (isNew(n.id)) movable.push({ id: n.id, rect: rectFor(n, p) });
    else obstacles.push(rectFor(n, p));
  }
  movable.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

  for (const m of movable) {
    let rect = m.rect;

    // Phase 1 — minimal least-penetration nudges. Keeps the card near dagre's
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

    // Phase 2 — guarantee. If a card is boxed in on opposing sides, phase 1 can
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
 * Lay out the graph while keeping already-placed nodes pinned, so adding a
 * node (e.g. a staged-create ghost) or removing one never reshuffles the
 * rest — the operator's mental map (and any open detail panel anchored on a
 * node) stays put. Genuinely-new nodes are placed by a fresh dagre pass,
 * translated to align with the cached layout via one shared anchor node so
 * they land in the right neighbourhood rather than at dagre's origin.
 *
 * `cached` is the running id → position map; the return value is the next
 * one (callers persist it across renders).
 */
export function incrementalLayout(
  nodes: Node[],
  edges: Edge[],
  cached: Map<string, XY>,
): Map<string, XY> {
  if (nodes.length === 0) return new Map();

  const fresh = new Map(layoutGraph(nodes, edges).map((n) => [n.id, n.position] as const));

  // First layout (nothing cached yet) — adopt dagre's result wholesale.
  if (cached.size === 0) return fresh;

  const isNew = (id: string) => !cached.has(id);
  const hasNew = nodes.some((n) => isNew(n.id));

  // Pure removal / no change: survivors keep their cached spot; fall back to
  // the fresh pass only for anything somehow missing a cached position.
  if (!hasNew) {
    return new Map(nodes.map((n) => [n.id, cached.get(n.id) ?? fresh.get(n.id) ?? { x: 0, y: 0 }]));
  }

  // Additions present: anchor the fresh pass to the cached layout using the
  // first node that exists in both, then offset new nodes by that delta.
  const anchor = nodes.find((n) => !isNew(n.id))?.id;
  const cachedAnchor = anchor ? cached.get(anchor) : undefined;
  const freshAnchor = anchor ? fresh.get(anchor) : undefined;
  const dx = cachedAnchor && freshAnchor ? cachedAnchor.x - freshAnchor.x : 0;
  const dy = cachedAnchor && freshAnchor ? cachedAnchor.y - freshAnchor.y : 0;

  const next = new Map<string, XY>();
  for (const n of nodes) {
    const pinned = cached.get(n.id);
    if (pinned) {
      next.set(n.id, pinned);
      continue;
    }
    const f = fresh.get(n.id);
    next.set(n.id, f ? { x: f.x + dx, y: f.y + dy } : { x: 0, y: 0 });
  }

  // The anchor-delta only lines up one node; pinned cards sit at cached /
  // dragged / persisted spots dagre never saw, so a shifted newcomer can land
  // on top of one. Nudge the new nodes clear — pinned ones stay put.
  resolveNewCollisions(next, nodes, isNew);
  return next;
}

/**
 * Stable fingerprint of the graph's *topology* — the set of node ids and the
 * source→target edge pairs, both sorted so order doesn't matter. Dagre only
 * reads ids + fixed dimensions, so two graphs with the same signature lay out
 * identically. The canvas memoizes layout on this: live status/replica ticks
 * (which change node *data* but not the id set) reuse cached positions, so
 * nodes only move when one is genuinely added or removed.
 */
export function topologySignature(nodes: Node[], edges: Edge[]): string {
  const nodeKeys = nodes
    .map((n) => n.id)
    .sort()
    .join(",");
  const edgeKeys = edges
    .map((e) => `${e.source}->${e.target}`)
    .sort()
    .join(",");
  return `${nodeKeys}|${edgeKeys}`;
}

function layoutGraph<TNode extends Node>(nodes: TNode[], edges: Edge[]): TNode[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: 40,
    marginy: 40,
  });

  const heights = new Map<string, number>();
  for (const node of nodes) {
    const height = nodeHeight(node);
    heights.set(node.id, height);
    g.setNode(node.id, { width: NODE_WIDTH, height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Dagre reports center coordinates; React Flow wants top-left. Subtract
  // half the node's own dimensions to convert (height varies for groups).
  return nodes.map((node) => {
    const laid = g.node(node.id);
    if (!laid) return node;
    return {
      ...node,
      position: {
        x: laid.x - NODE_WIDTH / 2,
        y: laid.y - (heights.get(node.id) ?? NODE_HEIGHT) / 2,
      },
    };
  });
}
