/**
 * Mapping from oRPC `ProjectResource` union → React-Flow node shape consumed
 * by the graph canvas. Pure function — no live runtime state, no replicas.
 * Those layers get filled in by D.3/D.4 once the swarm-stats handlers land.
 */

import type { Node } from "@xyflow/react";

import type { InferRouterOutputs } from "@orpc/server";

import type { AppRouter } from "@otterstack/api/routers/index";

import type { ResourceNodeData } from "./resource-node";

export type ProjectResource = InferRouterOutputs<AppRouter>["project"]["resource"]["list"][number];

export type ResourceFlowNode = Node<ResourceNodeData, "resource">;

export function resourceToNode(r: ProjectResource): ResourceFlowNode {
  switch (r.type) {
    case "database":
      return {
        id: r.resourceId,
        type: "resource",
        // Dagre will overwrite these — keep at origin so an un-laid-out node
        // is still mountable (useful in tests).
        position: { x: 0, y: 0 },
        data: {
          kind: "database",
          name: r.name,
          description: `${r.engine} database`,
          engine: r.engine,
        },
      };
    case "service":
      return {
        id: r.resourceId,
        type: "resource",
        position: { x: 0, y: 0 },
        data: {
          kind: "service",
          name: r.name,
          // Until services carry a description field, the image string is the
          // most informative single line we can show.
          description: r.image,
          tech: { label: r.image },
        },
      };
  }
}
