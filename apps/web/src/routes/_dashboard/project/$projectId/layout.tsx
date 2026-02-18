import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";

import {
  addEdge,
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";

import "@xyflow/react/dist/style.css";

import { ResourceNodeComponent, GroupNodeComponent } from "@/components/resource/node";

export const Route = createFileRoute("/_dashboard/project/$projectId")({
  component: RouteComponent,
});

const initialNodes: Node[] = [
  // --- Groups (must come before their children) ---
  {
    id: "group-services",
    type: "group",
    position: { x: 0, y: 0 },
    style: { width: 760, height: 170 },
    data: { label: "Services" },
  },
  {
    id: "group-data",
    type: "group",
    position: { x: 240, y: 210 },
    style: { width: 520, height: 190 },
    data: { label: "Data Layer" },
  },
  // --- Services (all same y so they align horizontally) ---
  {
    id: "1",
    type: "resource",
    parentId: "group-services",
    position: { x: 16, y: 56 },
    data: { name: "Frontend", kind: "web", status: "online", metadata: {} },
  },
  {
    id: "2",
    type: "resource",
    parentId: "group-services",
    position: { x: 264, y: 56 },
    data: { name: "API Server", kind: "api", status: "online", metadata: {} },
  },
  {
    id: "5",
    type: "resource",
    parentId: "group-services",
    position: { x: 520, y: 56 },
    data: { name: "Job Runner", kind: "worker", status: "deploying", metadata: {} },
  },
  // --- Data Layer (same y, aligned horizontally) ---
  {
    id: "3",
    type: "resource",
    parentId: "group-data",
    position: { x: 16, y: 56 },
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
    parentId: "group-data",
    position: { x: 272, y: 56 },
    data: { name: "Redis", kind: "cache", status: "degraded", metadata: {} },
  },
];

const initialEdges = [
  // Frontend → API Server
  {
    id: "e1",
    source: "1",
    sourceHandle: "right",
    target: "2",
    targetHandle: "left",
    type: "smoothstep",
    animated: true,
  },
  // API Server → Job Runner
  {
    id: "e2",
    source: "2",
    sourceHandle: "right",
    target: "5",
    targetHandle: "left",
    type: "smoothstep",
    animated: true,
  },
  // API Server → PostgreSQL
  {
    id: "e3",
    source: "2",
    sourceHandle: "bottom",
    target: "3",
    targetHandle: "top",
    type: "smoothstep",
    animated: true,
  },
  // API Server → Redis
  {
    id: "e4",
    source: "2",
    sourceHandle: "bottom",
    target: "4",
    targetHandle: "top",
    type: "smoothstep",
    animated: true,
  },
  // Job Runner → Redis
  {
    id: "e5",
    source: "5",
    sourceHandle: "bottom",
    target: "4",
    targetHandle: "top",
    type: "smoothstep",
    animated: true,
  },
];

const nodeTypes = {
  resource: ResourceNodeComponent,
  group: GroupNodeComponent,
};

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
  const activeId = serviceMatch ? serviceMatch.serviceId : volumeMatch ? volumeMatch.volume : null;

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

const GROUP_PADDING = { top: 50, right: 20, bottom: 20, left: 16 };
const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 80;

function resizeGroups(nodes: Node[]): Node[] {
  const groups = nodes.filter((n) => n.type === "group");
  const children = nodes.filter((n) => n.parentId);

  const updated = new Map<string, { width: number; height: number }>();

  for (const group of groups) {
    const kids = children.filter((n) => n.parentId === group.id);
    if (kids.length === 0) continue;

    let maxX = 0;
    let maxY = 0;

    for (const kid of kids) {
      const w = kid.measured?.width ?? DEFAULT_NODE_WIDTH;
      const h = kid.measured?.height ?? DEFAULT_NODE_HEIGHT;
      maxX = Math.max(maxX, kid.position.x + w);
      maxY = Math.max(maxY, kid.position.y + h);
    }

    updated.set(group.id, {
      width: maxX + GROUP_PADDING.right,
      height: maxY + GROUP_PADDING.bottom,
    });
  }

  if (updated.size === 0) return nodes;

  return nodes.map((n) => {
    const newSize = updated.get(n.id);
    if (!newSize) return n;
    return { ...n, style: { ...n.style, ...newSize } };
  });
}

function RouteComponent() {
  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect: OnConnect = useCallback(
    (params) => setEdges((els) => addEdge(params, els)),
    [setEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds);
        // Clamp child nodes so they stay within the group padding
        const clamped = updated.map((n) => {
          if (!n.parentId) return n;
          const x = Math.max(GROUP_PADDING.left, n.position.x);
          const y = Math.max(GROUP_PADDING.top, n.position.y);
          if (x === n.position.x && y === n.position.y) return n;
          return { ...n, position: { x, y } };
        });
        return resizeGroups(clamped);
      });
    },
    [setNodes],
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
