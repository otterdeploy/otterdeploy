/**
 * Fold the previews API payload into React-Flow satellite nodes + dashed
 * edges. One card per (preview, service) pair, attached to the service node
 * it previews. Positions are computed later in the layout memo (right of the
 * parent, outside dagre) — nodes leave here at 0,0.
 */
import type { Edge } from "@xyflow/react";

import type { ResourceFlowNode } from "./resource-node-types";

export interface PreviewApiEntry {
  id: string;
  prNumber: number;
  branch: string;
  headSha: string;
  slug: string;
  state: "active" | "closed";
  services: {
    resourceId: string;
    serviceName: string;
    status: "pending" | "building" | "running" | "failed" | "superseded" | "removed" | "none";
    url: string | null;
  }[];
}

export function buildPreviewSatellites(
  previews: PreviewApiEntry[],
  serviceNodeIds: Set<string>,
): { nodes: ResourceFlowNode[]; edges: Edge[] } {
  const nodes: ResourceFlowNode[] = [];
  const edges: Edge[] = [];

  for (const p of previews) {
    if (p.state !== "active") continue;
    for (const svc of p.services) {
      const parentId = `service:${svc.serviceName}`;
      // A satellite with no parent card (renamed/removed service) would float
      // unanchored — skip it; the PR comment still covers that preview.
      if (!serviceNodeIds.has(parentId)) continue;
      const id = `preview:${svc.serviceName}:${p.prNumber}`;
      nodes.push({
        id,
        type: "resource",
        position: { x: 0, y: 0 },
        data: {
          kind: "preview",
          name: `#${p.prNumber}`,
          description: p.branch,
          preview: {
            id: p.id,
            prNumber: p.prNumber,
            branch: p.branch,
            status: svc.status,
            url: svc.url,
            parentId,
          },
        },
      });
      edges.push({
        id: `${parentId}->${id}`,
        source: parentId,
        target: id,
        // Dashed muted stroke — the preview-attachment vocabulary. Inherits
        // the default smoothstep type + 1.25px muted stroke from the canvas.
        style: { strokeDasharray: "6 4" },
      });
    }
  }
  return { nodes, edges };
}
