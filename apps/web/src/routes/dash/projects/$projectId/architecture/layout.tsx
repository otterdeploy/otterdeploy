import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { mutators } from "@otterdeploy/zero/mutators";
import {
  createFileRoute,
  Outlet,
  useMatchRoute,
} from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";

import {
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  type Node,
  type NodeChange,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { ResourceNodeComponent, GroupNodeComponent } from "@/components/resource/node";
import { ViewportController } from "@/components/project/viewport-controller";
import { useProjectContext } from "@/components/project/context";

export const Route = createFileRoute("/dash/projects/$projectId/architecture")({
  component: RouteComponent,
});

const nodeTypes = {
  resource: ResourceNodeComponent,
  group: GroupNodeComponent,
};

function RouteComponent() {
  const { pendingChanges, onMarkForRemoval, onRedeploy, environmentId } = useProjectContext();

  const [resources] = useQuery(
    environmentId ? queries.resource.list({ environmentId }) : undefined,
  );

  const zero = useZero();
  const removeResourceRef = useRef<(id: string) => void>(() => {});
  removeResourceRef.current = onMarkForRemoval;

  const redeployResourceRef = useRef<(resource: { id: string; kind: string; databaseEngine?: string }) => Promise<void>>(async () => {});
  redeployResourceRef.current = onRedeploy;

  const graphNodes = useMemo<Node[]>(() => {
    if (!resources) return [];
    return resources.map((r) => {
      const pending = pendingChanges.find((c) => c.id === r.id);
      const isRemoved = pending?.action === "removed";
      return {
        id: r.id,
        type: "resource",
        position: { x: r.position?.posX ?? 0, y: r.position?.posY ?? 0 },
        draggable: !isRemoved,
        selectable: !isRemoved,
        data: {
          name: r.name,
          kind: r.kind,
          status: r.status ?? "unknown",
          pendingAction: pending?.action,
          onRemove: (id: string) => removeResourceRef.current(id),
          onRedeploy: (id: string) => {
            const res = resources?.find((res) => res.id === id);
            if (res) redeployResourceRef.current({ id: res.id, kind: res.kind });
          },
        },
      };
    });
  }, [resources, pendingChanges]);

  // Local nodes for React Flow — synced from Zero, updated locally during drag via applyNodeChanges
  const [nodes, setNodes] = useState<Node[]>(graphNodes);
  useEffect(() => {
    setNodes((prev) => {
      if (prev.length === 0) return graphNodes;
      if (graphNodes.length === 0) return graphNodes;

      // Merge: update data/position from Zero while preserving React Flow's
      // local state (selected, measured, dragging, etc.)
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      let anyChanged = prev.length !== graphNodes.length;

      const next = graphNodes.map((gn) => {
        const existing = prevMap.get(gn.id);
        if (!existing) {
          anyChanged = true;
          return gn;
        }

        const d = existing.data;
        const nd = gn.data;
        const dataEqual =
          d.name === nd.name &&
          d.kind === nd.kind &&
          d.status === nd.status &&
          d.pendingAction === nd.pendingAction &&
          d.attachments === nd.attachments;
        const posEqual =
          existing.position.x === gn.position.x && existing.position.y === gn.position.y;
        const propsEqual =
          existing.draggable === gn.draggable && existing.selectable === gn.selectable;

        if (dataEqual && posEqual && propsEqual) {
          return existing;
        }

        anyChanged = true;
        return { ...existing, ...gn };
      });

      return anyChanged ? next : prev;
    });
  }, [graphNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Apply all visual changes (position, selection, dimensions) locally for smooth drag
      const visualChanges = changes.filter((c) => c.type !== "remove");
      if (visualChanges.length > 0) {
        setNodes((prev) => applyNodeChanges(visualChanges, prev));
      }

      // Persist final position to Zero on drag end
      for (const change of changes) {
        if (change.type === "position" && change.position && !change.dragging) {
          zero.mutate(
            mutators.resourcePosition.update({
              resourceId: change.id,
              posX: change.position.x,
              posY: change.position.y,
              now: Date.now(),
            }),
          );
        }
        if (change.type === "remove") {
          onMarkForRemoval(change.id);
        }
      }
    },
    [zero, onMarkForRemoval],
  );

  const match = useMatchRoute();

  const serviceMatch = match({
    to: "/dash/projects/$projectId/architecture/service/$serviceId",
    fuzzy: true,
  });
  const volumeMatch = match({
    to: "/dash/projects/$projectId/architecture/volume/$volume",
    fuzzy: true,
  });
  const showChild = serviceMatch || volumeMatch;

  return (
    <>
      <div className="absolute inset-0">
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          colorMode="dark"
          fitView
          style={{ width: "100%", height: "100%" }}
        >
          <Controls />
          <Background />
          <ViewportController />
        </ReactFlow>
      </div>

      <AnimatePresence initial={false}>
        {showChild && (
          <motion.div
            key="child-panel"
            className="border-white/10 border-l-1 bg-background border-t-1 overflow-hidden h-[90vh] w-[60vw] max-md:w-full absolute right-0 bottom-0 rounded-tl-xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25 }}
          >
            <Outlet />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
