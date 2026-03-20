import { createFileRoute, Outlet } from "@tanstack/react-router";
import * as z from "zod";

import { useCallback } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";

import {
  DatabaseResource,
  type DatabaseResourceNode,
} from "@/features/project-flow/components/database-resource";

const searchParams = z.object({
  env: z.string().default("development"),
});

export const Route = createFileRoute("/_dashboard/project/$projectId")({
  validateSearch: searchParams,
  component: RouteComponent,
});

const nodeTypes: NodeTypes = {
  database: DatabaseResource,
};

const initialNodes: DatabaseResourceNode[] = [
  {
    id: "db-primary",
    type: "database",
    dragHandle: ".resource-drag-handle",
    position: { x: 160, y: 120 },
    data: {
      category: "Database",
      name: "primary-db",
      engine: "PostgreSQL",
      image: "postgres:16",
      volumes: [
        {
          id: "db-data:/var/lib/postgresql/data",
          source: "db-data",
          target: "/var/lib/postgresql/data",
        },
      ],
    },
  },
];
const initialEdges: Edge[] = [];

function RouteComponent() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [setEdges],
  );

  return (
    <div className="p-4 w-full h-screen">
      <ReactFlow
        className="rounded-2xl border border-border bg-background/70"
        defaultEdgeOptions={{
          style: {
            stroke: "rgba(115, 115, 130, 0.7)",
            strokeWidth: 1.5,
          },
          type: "smoothstep",
        }}
        nodes={nodes}
        nodeTypes={nodeTypes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background
          id="dots"
          variant={BackgroundVariant.Dots}
          gap={8}
          color="rgba(120, 120, 140, 0.3)"
        />
      </ReactFlow>
      <Outlet />
    </div>
  );
}
