import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";

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

export const Route = createFileRoute("/_dashboard/project/$projectId")({
  component: RouteComponent,
});

const initialNodes = [
  {
    id: "1",
    type: "resource",
    position: { x: 0, y: 0 },
    data: { name: "Frontend", kind: "web", status: "online", metadata: {} },
  },
  {
    id: "2",
    type: "resource",
    position: { x: 350, y: 0 },
    data: { name: "API Server", kind: "api", status: "online", metadata: {} },
  },
  {
    id: "3",
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
    id: "4",
    type: "resource",
    position: { x: 700, y: 200 },
    data: { name: "Redis", kind: "cache", status: "degraded", metadata: {} },
  },
  {
    id: "5",
    type: "resource",
    position: { x: 350, y: 200 },
    data: { name: "Job Runner", kind: "worker", status: "deploying", metadata: {} },
  },
];

const initialEdges = [
  {
    id: "e1",
    source: "1",
    sourceHandle: "right",
    target: "api",
    targetHandle: "left",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "e2",
    source: "2",
    sourceHandle: "right",
    target: "3",
    targetHandle: "left",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "e3",
    source: "2",
    sourceHandle: "bottom",
    target: "4",
    targetHandle: "left",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "e4",
    source: "2",
    sourceHandle: "bottom",
    target: "5",
    targetHandle: "top",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "e5",
    source: "5",
    sourceHandle: "right",
    target: "4",
    targetHandle: "left",
    type: "smoothstep",
    animated: true,
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
