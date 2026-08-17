/**
 * Dagre auto-layout for the resource graph. Pure function: takes the nodes +
 * edges, returns nodes with absolute positions. Top-to-bottom rank so routes
 * (later) sit above services, services above databases, same visual as the
 * old hand-positioned mock.
 */

import type { Edge, Node } from "@xyflow/react";

import dagre from "dagre";

import type { Rect, SizeLookup, XY } from "./layout-collision";

import {
  boundingBoxOf,
  nodeHeight,
  NODE_WIDTH,
  rectFor,
  resolveNewCollisions,
} from "./layout-collision";

// Dagre's own spacing knobs. Card dimensions and the collision gap live with
// the geometry in ./layout-collision.
const RANK_SEP = 140;
const NODE_SEP = 80;

// Re-exported so callers keep one import for "the layout", and the tests keep
// measuring the same card the layout does.
export { NODE_WIDTH, resolveAllOverlaps, resolveNewCollisions } from "./layout-collision";
export type { NodeSize, SizeLookup, XY } from "./layout-collision";

function addAdjacency(map: Map<string, string[]>, from: string, to: string): void {
  const arr = map.get(from);
  if (arr) arr.push(to);
  else map.set(from, [to]);
}

/**
 * For every node reachable from a pinned node by a chain of edges (undirected,
 * a dependency edge connects two cards regardless of its source/target
 * direction), the id of the NEAREST pinned node it's reachable from (fewest
 * hops; ties broken by `pinnedIds` order, so the result is deterministic).
 * Pinned nodes own themselves. A multi-source BFS from every pinned node at
 * once, so an id's owner is always the closest one, not just the first
 * pinned node in the list.
 *
 * Lets a genuinely new node that's wired into the existing graph anchor on
 * the pinned neighbour it's actually connected to, rather than one arbitrary
 * pinned node picked for the whole graph. See {@link incrementalLayout}.
 */
function nearestPinnedOwner(edges: Edge[], pinnedIds: string[]): Map<string, string> {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    addAdjacency(adjacency, e.source, e.target);
    addAdjacency(adjacency, e.target, e.source);
  }
  const owner = new Map<string, string>();
  const queue: string[] = [];
  for (const id of pinnedIds) {
    owner.set(id, id);
    queue.push(id);
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const root = owner.get(id);
    if (root === undefined) continue;
    for (const next of adjacency.get(id) ?? []) {
      if (owner.has(next)) continue;
      owner.set(next, root);
      queue.push(next);
    }
  }
  return owner;
}

/**
 * Lay out the graph while keeping already-placed nodes pinned, so adding a
 * node (e.g. a staged-create ghost) or removing one never reshuffles the
 * rest: the operator's mental map (and any open detail panel anchored on a
 * node) stays put. Genuinely-new nodes are placed by a fresh dagre pass:
 * a new node wired (even transitively) to a pinned one rides that pass
 * translated onto the cached layout using ITS nearest pinned neighbour's own
 * delta, so it lands next to what it's actually connected to; a new node
 * with no edges at all (the common case right after the create wizard) is
 * anchored to the pinned cluster's own bounding box instead, in a fresh row
 * beneath it, so it always lands next to the existing cards rather than
 * wherever dagre racked up its own disconnected component (which, on an
 * already-wide graph, can be far off to the right).
 *
 * `cached` is the running id → position map; the return value is the next
 * one (callers persist it across renders).
 */
export function incrementalLayout(
  nodes: Node[],
  edges: Edge[],
  cached: Map<string, XY>,
  sizes?: SizeLookup,
): Map<string, XY> {
  if (nodes.length === 0) return new Map();

  const fresh = new Map(layoutGraph(nodes, edges).map((n) => [n.id, n.position] as const));

  // First layout (nothing cached yet). Adopt dagre's result wholesale.
  if (cached.size === 0) return fresh;

  const isNew = (id: string) => !cached.has(id);
  const hasNew = nodes.some((n) => isNew(n.id));

  // Pure removal / no change: survivors keep their cached spot; fall back to
  // the fresh pass only for anything somehow missing a cached position.
  if (!hasNew) {
    return new Map(nodes.map((n) => [n.id, cached.get(n.id) ?? fresh.get(n.id) ?? { x: 0, y: 0 }]));
  }

  // Additions present. Two placement strategies, chosen per new node:
  //
  //   - "wired": reachable (via a chain of edges) from a pinned node. Placed
  //     using THAT pinned neighbour's own fresh-vs-cached delta (not one
  //     arbitrary node picked for the whole graph), so it lands next to what
  //     it's actually connected to even when the graph has several separate
  //     clusters far apart.
  //   - "orphan", no edges at all yet, the normal state for a resource
  //     fresh off the create wizard (dependency edges only appear once an
  //     env var references another resource). dagre treats these as their
  //     own disconnected component and racks them up left-to-right, so on a
  //     graph with a handful of stacks that dagre-invented column can
  //     already be thousands of px past the last one. The far-right-edge
  //     bug. Placed instead relative to the pinned cluster's own bounding
  //     box, in a fresh row directly beneath it.
  const pinnedIds = nodes.filter((n) => !isNew(n.id)).map((n) => n.id);
  const owner = nearestPinnedOwner(edges, pinnedIds);
  const isOrphan = (id: string) => isNew(id) && !owner.has(id);

  const wiredDelta = pinnedDeltas(pinnedIds, cached, fresh);
  const orphanOffset = orphanBlockOffset(nodes, isNew, isOrphan, cached, fresh, sizes);
  const next = placeNodes(nodes, cached, fresh, isOrphan, owner, wiredDelta, orphanOffset);

  // Translating orphans as one rigid block only keeps THEM apart from each
  // other; it says nothing about the pinned cluster's actual shape (an
  // operator-dragged layout is never a tidy rectangle). Nudge every new node
  // clear, pinned ones stay put.
  resolveNewCollisions(next, nodes, isNew, sizes);
  return next;
}

/**
 * Per-pinned-node offset between where it sits now and where the fresh
 * dagre pass just put it. Wired new nodes borrow their owner's offset.
 */
function pinnedDeltas(
  pinnedIds: string[],
  cached: Map<string, XY>,
  fresh: Map<string, XY>,
): Map<string, XY> {
  const wiredDelta = new Map<string, XY>();
  for (const p of pinnedIds) {
    const c = cached.get(p);
    const f = fresh.get(p);
    if (c && f) wiredDelta.set(p, { x: c.x - f.x, y: c.y - f.y });
  }
  return wiredDelta;
}

/**
 * Translation that re-anchors the orphan block onto the row below the pinned
 * cluster. Orphans keep their position RELATIVE TO EACH OTHER from the fresh
 * pass (so several added in the same render still read as one group). Only
 * the block as a whole is re-anchored, from dagre's origin onto the row
 * below the pinned cluster. Zero when either bounding box is empty.
 */
function orphanBlockOffset(
  nodes: Node[],
  isNew: (id: string) => boolean,
  isOrphan: (id: string) => boolean,
  cached: Map<string, XY>,
  fresh: Map<string, XY>,
  sizes?: SizeLookup,
): XY {
  const pinnedRects: Rect[] = [];
  for (const n of nodes) {
    const pos = !isNew(n.id) ? cached.get(n.id) : undefined;
    if (pos) pinnedRects.push(rectFor(n, pos, sizes));
  }
  const pinnedBox = boundingBoxOf(pinnedRects);
  if (!pinnedBox) return { x: 0, y: 0 };

  const orphanRects: Rect[] = [];
  for (const n of nodes) {
    if (!isOrphan(n.id)) continue;
    const f = fresh.get(n.id);
    if (f) orphanRects.push(rectFor(n, f, sizes));
  }
  const orphanBox = boundingBoxOf(orphanRects);
  if (!orphanBox) return { x: 0, y: 0 };

  return {
    x: pinnedBox.x - orphanBox.x,
    y: pinnedBox.y + pinnedBox.h + RANK_SEP - orphanBox.y,
  };
}

/**
 * Final placement pass: pinned nodes keep their cached spot, orphans ride the
 * block offset, wired new nodes borrow their owner's delta, and anything the
 * fresh pass somehow missed lands at the origin.
 */
function placeNodes(
  nodes: Node[],
  cached: Map<string, XY>,
  fresh: Map<string, XY>,
  isOrphan: (id: string) => boolean,
  owner: Map<string, string>,
  wiredDelta: Map<string, XY>,
  orphanOffset: XY,
): Map<string, XY> {
  const next = new Map<string, XY>();
  for (const n of nodes) {
    const pinned = cached.get(n.id);
    if (pinned) {
      next.set(n.id, pinned);
      continue;
    }
    const f = fresh.get(n.id);
    if (!f) {
      next.set(n.id, { x: 0, y: 0 });
      continue;
    }
    if (isOrphan(n.id)) {
      next.set(n.id, { x: f.x + orphanOffset.x, y: f.y + orphanOffset.y });
      continue;
    }
    const delta = wiredDelta.get(owner.get(n.id) ?? "");
    next.set(n.id, { x: f.x + (delta?.x ?? 0), y: f.y + (delta?.y ?? 0) });
  }
  return next;
}

/**
 * Stable fingerprint of the graph's *topology*. The set of node ids and the
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
        y: laid.y - (heights.get(node.id) ?? nodeHeight(node)) / 2,
      },
    };
  });
}
