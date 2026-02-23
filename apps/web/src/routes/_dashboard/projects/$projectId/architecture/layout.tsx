import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { mutators } from "@otterdeploy/zero/mutators";
import {
  createFileRoute,
  Outlet,
  useMatchRoute,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";

import {
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  type Node,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { ResourceNodeComponent, GroupNodeComponent, type Kind } from "@/components/resource/node";
import { ViewportController } from "@/components/project/viewport-controller";
import { useProjectContext } from "@/routes/_dashboard/projects/$projectId/layout";

export const Route = createFileRoute("/_dashboard/projects/$projectId/architecture")({
  component: RouteComponent,
});

const nodeTypes = {
  resource: ResourceNodeComponent,
  group: GroupNodeComponent,
};

function RouteComponent() {
  const { projectId } = useParams({ strict: false });
  const { pendingChanges, onMarkForRemoval } = useProjectContext();

  const [environments] = useQuery(projectId ? queries.environmentList({ projectId }) : undefined);
  const firstEnvId = environments?.[0]?.id;

  const [resources] = useQuery(
    firstEnvId ? queries.resourceList({ environmentId: firstEnvId }) : undefined,
  );
  const [links] = useQuery(
    firstEnvId ? queries.resourceLinkList({ environmentId: firstEnvId }) : undefined,
  );

  const { zero } = useRouter().options.context;
  const removeResourceRef = useRef<(id: string) => void>(() => {});
  removeResourceRef.current = onMarkForRemoval;

  // Find volumes mounted to databases — they render as attachments, not standalone nodes
  const { mountedVolumeIds, volumeAttachments } = useMemo(() => {
    const mounted = new Set<string>();
    const attachments = new Map<string, { id: string; kind: Kind; name: string }[]>();
    if (!resources || !links) return { mountedVolumeIds: mounted, volumeAttachments: attachments };

    for (const link of links) {
      const source = resources.find((r) => r.id === link.sourceResourceId);
      const target = resources.find((r) => r.id === link.targetResourceId);
      let dbId: string | null = null;
      let volume: typeof source | null = null;

      if (source?.kind === "database" && target?.kind === "volume") {
        dbId = source.id;
        volume = target;
      } else if (source?.kind === "volume" && target?.kind === "database") {
        dbId = target.id;
        volume = source;
      }

      if (dbId && volume) {
        mounted.add(volume.id);
        const existing = attachments.get(dbId) ?? [];
        existing.push({ id: volume.id, kind: volume.kind as Kind, name: volume.name });
        attachments.set(dbId, existing);
      }
    }

    return { mountedVolumeIds: mounted, volumeAttachments: attachments };
  }, [resources, links]);

  const graphNodes = useMemo<Node[]>(() => {
    if (!resources) return [];
    return resources
      .filter((r) => !mountedVolumeIds.has(r.id))
      .map((r) => {
        const pending = pendingChanges.find((c) => c.id === r.id);
        const isRemoved = pending?.action === "removed";
        return {
          id: r.id,
          type: "resource",
          position: { x: r.posX ?? 0, y: r.posY ?? 0 },
          draggable: !isRemoved,
          selectable: !isRemoved,
          data: {
            name: r.name,
            kind: r.kind,
            status: r.status ?? "unknown",
            metadata: r.metadata ?? {},
            pendingAction: pending?.action,
            onRemove: (id: string) => removeResourceRef.current(id),
            attachments: volumeAttachments.get(r.id),
          },
        };
      });
  }, [resources, pendingChanges, mountedVolumeIds, volumeAttachments]);

  // Local nodes for React Flow — synced from Zero, updated locally during drag via applyNodeChanges
  const [nodes, setNodes] = useState<Node[]>(graphNodes);
  useEffect(() => {
    setNodes((prev) => {
      if (prev.length === 0) return graphNodes;
      if (graphNodes.length === 0) return graphNodes;

      // Merge: update data/position from Zero while preserving React Flow's
      // local state (selected, measured, dragging, etc.)
      // Only create new node objects when Zero data actually changed.
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      let anyChanged = prev.length !== graphNodes.length;

      const next = graphNodes.map((gn) => {
        const existing = prevMap.get(gn.id);
        if (!existing) {
          anyChanged = true;
          return gn;
        }

        // Compare Zero-sourced properties to avoid unnecessary re-renders
        const d = existing.data as Record<string, unknown>;
        const nd = gn.data as Record<string, unknown>;
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
          return existing; // keep same reference — React Flow skips re-render
        }

        anyChanged = true;
        return { ...existing, ...gn };
      });

      return anyChanged ? next : prev;
    });
  }, [graphNodes]);

  const graphEdges = useMemo(() => {
    if (!links) return [];
    return links
      .filter(
        (l) =>
          !mountedVolumeIds.has(l.sourceResourceId) && !mountedVolumeIds.has(l.targetResourceId),
      )
      .map((l) => ({
        id: l.id,
        source: l.sourceResourceId,
        target: l.targetResourceId,
        type: "smoothstep",
        animated: true,
      }));
  }, [links, mountedVolumeIds]);

  const onConnect: OnConnect = useCallback(
    (params) => {
      if (!zero || !firstEnvId) return;
      const id = crypto.randomUUID();
      zero.mutate(
        mutators.resourceLink.create({
          id,
          environmentId: firstEnvId,
          sourceResourceId: params.source,
          targetResourceId: params.target,
          linkType: "depends_on",
        }),
      );
    },
    [zero, firstEnvId],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Apply all visual changes (position, selection, dimensions) locally for smooth drag
      const visualChanges = changes.filter((c) => c.type !== "remove");
      if (visualChanges.length > 0) {
        setNodes((prev) => applyNodeChanges(visualChanges, prev));
      }

      // Persist final position to Zero on drag end
      for (const change of changes) {
        if (change.type === "position" && change.position && !change.dragging && zero) {
          zero.mutate(
            mutators.resource.update({
              id: change.id,
              posX: change.position.x,
              posY: change.position.y,
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
    to: "/projects/$projectId/architecture/service/$serviceId",
    fuzzy: true,
  });
  const volumeMatch = match({
    to: "/projects/$projectId/architecture/volume/$volume",
    fuzzy: true,
  });
  const showChild = serviceMatch || volumeMatch;

  return (
    <>
      <div className="absolute inset-0">
        <ReactFlow
          nodes={nodes}
          edges={graphEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          colorMode="dark"
          fitView
          style={{ width: "100%", height: "100%" }}
        >
          <Controls />
          <Background />
          <ViewportController />
        </ReactFlow>
      </div>

      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={showChild ? "child-panel" : "parent-panel"}
          className="border-white/10 border-l-1 bg-background border-t-1 overflow-hidden h-[90vh] w-[60vw] max-md:w-full absolute right-0 bottom-0 rounded-tl-xl"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          hidden={!showChild}
          transition={{ type: "tween", duration: 0.25 }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </>
  );
}
