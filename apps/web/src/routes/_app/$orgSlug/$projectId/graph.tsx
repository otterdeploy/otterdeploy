import { Database02Icon, FlashIcon } from "@hugeicons/core-free-icons";
import { createFileRoute } from "@tanstack/react-router";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";

import {
  ResourceNode,
  type ResourceNodeData,
} from "@/features/projects/components/graph/resource-node";

export const Route = createFileRoute("/_app/$orgSlug/$projectId/graph")({
  component: RouteComponent,
  staticData: { crumb: "Graph" },
});

const nodeTypes = { resource: ResourceNode };

const initialNodes: Node<ResourceNodeData>[] = [
  {
    id: "api",
    type: "resource",
    position: { x: 0, y: 0 },
    data: {
      kind: "service",
      name: "api",
      description: "Public-facing API for the web client. Handles auth, oRPC routes, and Inngest triggers.",
      status: "running",
      tech: { label: "Bun 1.3", icon: FlashIcon },
    },
  },
  {
    id: "postgres",
    type: "resource",
    position: { x: 360, y: 200 },
    data: {
      kind: "database",
      name: "postgres",
      description: "Primary application database. Schema managed via Drizzle migrations.",
      status: "running",
      tech: { label: "Postgres 16", icon: Database02Icon },
    },
  },
];

const initialEdges: Edge[] = [
  { id: "api-postgres", source: "api", target: "postgres" },
];

function RouteComponent() {
  return (
    <div className="flex flex-1 overflow-hidden bg-muted/40 p-3">
      <div className="flex-1 overflow-hidden rounded-2xl border bg-background">
        <ReactFlowProvider>
          <ReactFlow
            defaultNodes={initialNodes}
            defaultEdges={initialEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.4 }}
          >
            <Background gap={14} size={1} className="opacity-50" />
            <Controls />
            <MiniMap pannable zoomable maskStrokeWidth={1} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
