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
