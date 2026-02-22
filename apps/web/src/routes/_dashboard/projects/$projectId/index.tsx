import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Controls,
  Background,
  type OnConnect,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { ResourceNodeComponent, GroupNodeComponent } from "@/components/resource/node";

const searchSchema = z.object({
  env: z.string().default("production"),
});

export const Route = createFileRoute("/_dashboard/projects/$projectId/")({
  component: RouteComponent,
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params: { projectId } }) => {
    if (context.zero) {
      context.zero.run(queries.environmentList({ projectId }));
    }
  },
  loader: async ({ context, params }) => {
    if (context.zero) {
      context.zero.run(queries.environmentList({ projectId: params.projectId }));
    }
  },

  errorComponent: ({ error }) => <div>Error: {error.message}</div>,
});

const nodeTypes = {
  resource: ResourceNodeComponent,
  group: GroupNodeComponent,
};

function RouteComponent() {
  const { projectId } = Route.useParams();
  const { env } = Route.useSearch();

  const [environments] = useQuery(queries.environmentList({ projectId }));
  const matched = environments?.find((e) => e.name === env);

  const [resources] = useQuery(
    matched ? queries.resourceList({ environmentId: matched.id }) : undefined,
  );
  const [links] = useQuery(
    matched ? queries.resourceLinkList({ environmentId: matched.id }) : undefined,
  );
  const [viewport] = useQuery(
    matched ? queries.viewport({ environmentId: matched.id }) : undefined,
  );

  const graphNodes = useMemo(() => {
    if (!resources) return [];
    return resources.map((r) => ({
      id: r.id,
      type: "resource" as const,
      position: { x: r.posX ?? 0, y: r.posY ?? 0 },
      data: {
        id: r.id,
        name: r.name,
        kind: r.kind,
        status: r.status ?? "unknown",
        metadata: r.metadata ?? {},
      },
    }));
  }, [resources]);

  const graphEdges = useMemo(() => {
    if (!links) return [];
    return links.map((l) => ({
      id: l.id,
      source: l.sourceResourceId,
      target: l.targetResourceId,
      type: "smoothstep",
    }));
  }, [links]);

  const [nodes, , onNodesChange] = useNodesState(graphNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphEdges);
  const onConnect: OnConnect = useCallback(
    (params) => setEdges((els) => addEdge(params, els)),
    [setEdges],
  );

  return (
    <div style={{ height: "100dvh" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        defaultViewport={viewport ? { x: viewport.x ?? 0, y: viewport.y ?? 0, zoom: viewport.zoom ?? 1 } : undefined}
        colorMode="dark"
        fitView={!viewport}
      >
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}
