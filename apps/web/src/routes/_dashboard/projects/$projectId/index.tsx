import { orpc } from "@/utils/orpc";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import * as z from "zod";

import { useCallback } from "react";
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
import { Result } from "better-result";

const searchSchema = z.object({
  env: z.string().default("production"),
});

export const Route = createFileRoute("/_dashboard/projects/$projectId/")({
  component: RouteComponent,
  validateSearch: searchSchema,
  beforeLoad: async ({ context, search: { env }, params: { projectId } }) => {
    const result = await Result.tryPromise(() =>
      context.queryClient.ensureQueryData(
        orpc.environment.list.queryOptions({
          input: { projectId },
        }),
      ),
    );

    if (result.isErr()) throw notFound();

    const envs = result.value;

    const matched = envs.find((e) => e.name === env);
    if (matched) return;

    const first = envs[0];
    if (!first) throw notFound();

    throw redirect({
      to: "/projects/$projectId",
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
    if (!matched) throw notFound();

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
  // --- Groups ---
  {
    id: "group-services",
    type: "group",
    position: { x: 0, y: 0 },
    style: { width: 780, height: 180 },
    data: { label: "Services" },
  },
  {
    id: "group-data",
    type: "group",
    position: { x: 300, y: 220 },
    style: { width: 480, height: 180 },
    data: { label: "Data Layer" },
  },
  // --- Resource nodes inside groups ---
  {
    id: "web",
    type: "resource",
    parentId: "group-services",
    extent: "parent" as const,
    position: { x: 20, y: 40 },
    data: {
      id: "web",
      name: "Frontend",
      kind: "web",
      status: "online",
      metadata: {},
    },
  },
  {
    id: "api",
    type: "resource",
    parentId: "group-services",
    extent: "parent" as const,
    position: { x: 270, y: 40 },
    data: {
      id: "api",
      name: "API Server",
      kind: "api",
      status: "online",
      metadata: {},
    },
  },
  {
    id: "worker",
    type: "resource",
    parentId: "group-services",
    extent: "parent" as const,
    position: { x: 540, y: 40 },
    data: {
      id: "worker",
      name: "Job Runner",
      kind: "worker",
      status: "deploying",
      metadata: {},
    },
  },
  {
    id: "db",
    type: "resource",
    parentId: "group-data",
    extent: "parent" as const,
    position: { x: 20, y: 40 },
    data: {
      id: "db",
      name: "PostgreSQL",
      kind: "database",
      status: "online",
      metadata: {},
      attachments: [{ id: "vol-pg", kind: "volume", name: "pg-data" }],
    },
  },
  {
    id: "cache",
    type: "resource",
    parentId: "group-data",
    extent: "parent" as const,
    position: { x: 270, y: 40 },
    data: {
      id: "cache",
      name: "Redis",
      kind: "cache",
      status: "degraded",
      metadata: {},
    },
  },
];
const initialEdges = [
  {
    id: "e1",
    source: "web",
    sourceHandle: "right",
    target: "api",
    targetHandle: "left",
    type: "smoothstep",
  },
  {
    id: "e2",
    source: "api",
    sourceHandle: "right",
    target: "worker",
    targetHandle: "left",
    type: "smoothstep",
  },
  {
    id: "e3",
    source: "api",
    sourceHandle: "bottom",
    target: "db",
    targetHandle: "top",
    type: "smoothstep",
  },
  {
    id: "e4",
    source: "api",
    sourceHandle: "bottom",
    target: "cache",
    targetHandle: "top",
    type: "smoothstep",
  },
  {
    id: "e5",
    source: "worker",
    sourceHandle: "bottom",
    target: "cache",
    targetHandle: "top",
    type: "smoothstep",
  },
];

const nodeTypes = {
  resource: ResourceNodeComponent,
  group: GroupNodeComponent,
};

function RouteComponent() {
  const { graph } = Route.useLoaderData();

  // const initialNodes = useMemo<Node<ResourceNodeData>[]>(
  //   () =>
  //     graph.nodes.map((n) => ({
  //       id: n.id,
  //       type: n.type,
  //       position: n.position,
  //       data: {
  //         name: n.data.name,
  //         kind: n.data.kind,
  //         status: n.data.status,
  //         metadata: n.data.metadata,
  //       },
  //     })),
  //   [graph.nodes],
  // );

  // const initialEdges = useMemo<Edge[]>(
  //   () =>
  //     graph.edges.map((e) => ({
  //       id: e.id,
  //       source: e.source,
  //       target: e.target,
  //       type: e.type,
  //     })),
  //   [graph.edges],
  // );

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
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        defaultViewport={graph.viewport}
        colorMode="dark"
        fitView
      >
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}
