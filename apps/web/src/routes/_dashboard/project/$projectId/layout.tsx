import { orpc } from "@/utils/orpc";
import { createFileRoute, Outlet, redirect, useMatchRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";

import * as z from "zod";

import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type OnConnect,
} from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";

import "@xyflow/react/dist/style.css";

import { ResourceNodeComponent } from "@/components/resource/node";

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
    if (matched) return { projectId };

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
    id: "web",
    type: "resource",
    position: { x: 0, y: 0 },
    data: { name: "Frontend", kind: "web", status: "online", metadata: {} },
  },
  {
    id: "api",
    type: "resource",
    position: { x: 350, y: 0 },
    data: { name: "API Server", kind: "api", status: "online", metadata: {} },
  },
  {
    id: "db",
    type: "resource",
    position: { x: 700, y: 0 },
    data: {
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
    position: { x: 700, y: 200 },
    data: { name: "Redis", kind: "cache", status: "degraded", metadata: {} },
  },
  {
    id: "worker",
    type: "resource",
    position: { x: 350, y: 200 },
    data: { name: "Job Runner", kind: "worker", status: "deploying", metadata: {} },
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
    target: "db",
    targetHandle: "left",
    type: "smoothstep",
  },
  {
    id: "e3",
    source: "api",
    sourceHandle: "bottom",
    target: "cache",
    targetHandle: "left",
    type: "smoothstep",
  },
  {
    id: "e4",
    source: "api",
    sourceHandle: "bottom",
    target: "worker",
    targetHandle: "top",
    type: "smoothstep",
  },
  {
    id: "e5",
    source: "worker",
    sourceHandle: "right",
    target: "cache",
    targetHandle: "left",
    type: "smoothstep",
  },
];

const nodeTypes = { resource: ResourceNodeComponent };

function ViewportController() {
  const { setCenter, getNode, getNodes, getViewport, fitView } = useReactFlow();
  const match = useMatchRoute();

  const serviceMatch = match({
    from: "/project/$projectId/service/$serviceId",
  });
  const volumeMatch = match({
    from: "/project/$projectId/volume/$volume",
  });

  const showChild = !!(serviceMatch || volumeMatch);
  const activeId = serviceMatch
    ? (serviceMatch as Record<string, string>).serviceId
    : volumeMatch
      ? (volumeMatch as Record<string, string>).volume
      : null;

  const prevShowChildRef = useRef(showChild);

  useEffect(() => {
    if (showChild && activeId) {
      let targetNode = getNode(activeId);

      // Volume attachments aren't top-level nodes — find the parent node
      if (!targetNode) {
        const parent = getNodes().find((n) =>
          (n.data as { attachments?: { id: string }[] })?.attachments?.some(
            (a) => a.id === activeId,
          ),
        );
        if (parent) targetNode = parent;
      }

      if (targetNode) {
        const { zoom } = getViewport();
        const panelWidth = window.innerWidth * 0.6;
        const nodeWidth = targetNode.measured?.width ?? 180;
        const nodeHeight = targetNode.measured?.height ?? 80;
        const nodeCenterX = targetNode.position.x + nodeWidth / 2;
        const nodeCenterY = targetNode.position.y + nodeHeight / 2;

        // Offset so the node sits centered in the visible left portion
        setCenter(nodeCenterX + panelWidth / (2 * zoom), nodeCenterY, {
          duration: 300,
          zoom,
        });
      }
    }

    // Panel just closed — re-fit all nodes in the full viewport
    if (!showChild && prevShowChildRef.current) {
      fitView({ duration: 300, padding: 0.2 });
    }

    prevShowChildRef.current = showChild;
  }, [showChild, activeId, setCenter, getNode, getNodes, getViewport, fitView]);

  return null;
}

function RouteComponent() {
  const { graph, resources } = Route.useLoaderData();

  // console.log({ resources, graph });

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

  const match = useMatchRoute();

  const serviceMatch = match({
    from: "/project/$projectId/service/$serviceId",
  });
  const volumeMatch = match({
    from: "/project/$projectId/volume/$volume",
  });

  const showChild = serviceMatch || volumeMatch;
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
        <ViewportController />
      </ReactFlow>

      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={showChild ? "child-panel" : "parent-panel"}
          className="border-white/10 border-l-1 bg-background border-t-1 overflow-hidden h-[95vh] w-[60vw] max-md:w-full absolute right-0 bottom-0 rounded-tl-xl"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          hidden={!showChild}
          transition={{ type: "tween", duration: 0.25 }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
