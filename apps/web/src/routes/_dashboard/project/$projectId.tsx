import { orpc } from "@/utils/orpc";
import { createFileRoute, redirect } from "@tanstack/react-router";
import * as z from "zod";

import { useCallback } from "react";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Controls,
  Background,
  type Edge,
  type OnConnect,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

const searchSchema = z.object({
  env: z.string().default("production"),
});

export const Route = createFileRoute("/_dashboard/project/$projectId")({
  component: RouteComponent,
  validateSearch: searchSchema,
  beforeLoad: async ({ context, search: { env }, params: { projectId } }) => {
    const envs = await context.queryClient.ensureQueryData(
      orpc.environment.list.queryOptions({
        input: { projectId },
      }),
    );

    const matched = envs.find((e) => e.name === env);
    if (matched) return;

    const first = envs[0];
    if (!first) throw new Error("No environments found");

    throw redirect({
      to: "/project/$projectId",
      params: { projectId },
      search: { env: first.name },
    });
  },
  loaderDeps: ({ search: { env } }) => ({ env }),
  loader: async ({ context, deps, params }) => {
    const { env } = deps;

    const envs = await context.queryClient.ensureQueryData(
      orpc.environment.list.queryOptions({
        input: { projectId: params.projectId },
      }),
    );

    const matched = envs.find((e) => e.name === env);
    if (!matched) throw new Error("Environment not found");

    const [resources, graph] = await Promise.all([
      context.queryClient.ensureQueryData(
        orpc.resource.list.queryOptions({
          input: {
            projectId: params.projectId,
            environmentId: matched.id,
          },
        }),
      ),
      context.queryClient.ensureQueryData(
        orpc.architecture.getGraph.queryOptions({
          input: {
            projectId: params.projectId,
            environmentId: matched.id,
          },
        }),
      ),
    ]);

    return { env: matched, resources, graph };
  },

  errorComponent: ({ error }) => <div>Error: {error.message}</div>,
});

const initialNodes = [
  {
    id: "1",
    position: { x: 0, y: 0 },
    data: { label: "Hello" },
  },
  {
    id: "2",
    position: { x: 300, y: 0 },
    data: { label: "World" },
  },
];

const initialEdges: Edge[] = [];

function RouteComponent() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect: OnConnect = useCallback(
    (params) => setEdges((els) => addEdge(params, els)),
    [setEdges],
  );

  return (
    <div style={{ height: "100dvh" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        colorMode="dark"
        fitView
      >
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}
