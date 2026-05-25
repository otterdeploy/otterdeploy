/**
 * Dagre auto-layout for the resource graph. Pure function: takes the nodes +
 * edges, returns nodes with absolute positions. Top-to-bottom rank so routes
 * (later) sit above services, services above databases — same visual as the
 * old hand-positioned mock.
 */

import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

// Match the rendered ResourceNode card so dagre's overlap detection is
// accurate. Width matches `w-92` (368px) plus the implicit padding; height is
// a rough average since cards grow with replicas/mounts trays.
const NODE_WIDTH = 420;
const NODE_HEIGHT = 220;
const RANK_SEP = 140;
const NODE_SEP = 80;

export function layoutGraph<TNode extends Node>(
  nodes: TNode[],
  edges: Edge[],
): TNode[] {
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

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Dagre reports center coordinates; React Flow wants top-left. Subtract
  // half the node dimensions to convert.
  return nodes.map((node) => {
    const laid = g.node(node.id);
    if (!laid) return node;
    return {
      ...node,
      position: {
        x: laid.x - NODE_WIDTH / 2,
        y: laid.y - NODE_HEIGHT / 2,
      },
    };
  });
}
