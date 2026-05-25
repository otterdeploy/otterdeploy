import { useEffect, useMemo, useRef } from "react";
import {
  createFileRoute,
  Outlet,
  useLoaderData,
  useMatch,
  useNavigate,
} from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import { layoutGraph } from "@/features/projects/components/graph/layout-graph";
import { ResourceNode } from "@/features/projects/components/graph/resource-node";
import { resourceToNode } from "@/features/projects/components/graph/resource-to-node";
import { createResourceCollection } from "@/features/projects/data/resource";
import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/graph")({
  component: RouteComponent,
  staticData: { crumb: "Graph" },
});

const nodeTypes = { resource: ResourceNode };

function RouteComponent() {
  return (
    <div className="relative flex flex-1 overflow-hidden p-3">
      <div className="relative flex-1 overflow-hidden rounded-2xl border">
        <ReactFlowProvider>
          <GraphCanvas />
          <div className="pointer-events-none absolute inset-0 top-10 z-10 flex size-full items-end justify-end">
            <Outlet />
          </div>
        </ReactFlowProvider>
      </div>
    </div>
  );
}

// Approx card dimensions for refocus math. Keep in sync with ResourceNode size.
const CARD_W = 420;
const CARD_H = 200;
// Side panel covers the right N/D of the canvas. Keep in sync with the
// panel's Tailwind width class in graph/$resourceId.tsx.
const PANEL_WIDTH_RATIO = 3 / 7;
const FOCUS_ZOOM = 1.15;

function GraphCanvas() {
  const navigate = useNavigate();
  const { orgSlug, projectSlug } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const { setCenter, fitView } = useReactFlow();

  // Per-project collection; same factory the resource detail panel uses so
  // both views share the underlying TanStack-Query cache.
  const resourceCollection = useMemo(
    () => createResourceCollection(project.id),
    [project.id],
  );
  const { data: resources = [] } = useLiveQuery(
    () => resourceCollection,
    [resourceCollection],
  );

  // Edges come from parsing ${{Resource.VAR}} references in service env vars
  // server-side (project.dependencies). Pure derivation — recomputed on read.
  const { data: dependencyEdges = [] } = useQuery(
    orpc.project.dependencies.queryOptions({
      input: { projectId: project.id },
    }),
  );

  const edgesFromDeps = useMemo<Edge[]>(
    () =>
      dependencyEdges.map((d) => ({
        id: `${d.source}->${d.target}`,
        source: d.source,
        target: d.target,
      })),
    [dependencyEdges],
  );

  // Lay out with both nodes and edges so dagre ranks consumers above their
  // dependencies (services above the databases they read from).
  const laidOut = useMemo(
    () => layoutGraph(resources.map(resourceToNode), edgesFromDeps),
    [resources, edgesFromDeps],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(edgesFromDeps);

  // Sync the laid-out nodes whenever the resource list changes. Per-user drag
  // state is intentionally not persisted here — dagre is the source of truth
  // until we add stored positions (out of scope for D.1).
  useEffect(() => {
    setNodes(laidOut);
  }, [laidOut, setNodes]);
  useEffect(() => {
    setEdges(edgesFromDeps);
  }, [edgesFromDeps, setEdges]);

  // Detect when the resource detail panel closes — fit the whole graph back
  // into view so the user gets the wide overview instead of staying parked
  // on the previously-focused node.
  const resourceMatch = useMatch({
    from: "/_app/$orgSlug/$projectSlug/graph/$resourceId",
    shouldThrow: false,
  });
  const panelOpen = !!resourceMatch;
  const wasOpen = useRef(panelOpen);
  useEffect(() => {
    if (wasOpen.current && !panelOpen) {
      void fitView({ padding: 0.2, duration: 400 });
    }
    wasOpen.current = panelOpen;
  }, [panelOpen, fitView]);

  const focusNode = (node: Node) => {
    // ReactFlow always renders a wrapper with class="react-flow". Measure it
    // directly — falling back to window.innerWidth wildly overshoots since the
    // sidebar + chrome eat most of the window.
    const wrapper = document.querySelector(".react-flow");
    const canvasWidth = wrapper?.clientWidth ?? 0;
    const targetX = node.position.x + CARD_W / 2;
    const targetY = node.position.y + CARD_H / 2;
    if (!canvasWidth) {
      // No measurable canvas: center honestly, accept the panel covers the
      // right portion of the node.
      setCenter(targetX, targetY, { zoom: FOCUS_ZOOM, duration: 400 });
      return;
    }
    // Goal: land the node at the center of the visible left strip (the
    // (1 - PANEL_WIDTH_RATIO) area not covered by the panel). The visible
    // strip's center sits PANEL_WIDTH_RATIO/2 to the left of viewport center,
    // so shift the camera right by that fraction in flow coordinates.
    const shiftRatio = PANEL_WIDTH_RATIO / 2;
    const xOffset = (canvasWidth * shiftRatio) / FOCUS_ZOOM;
    setCenter(targetX + xOffset, targetY, { zoom: FOCUS_ZOOM, duration: 400 });
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: "smoothstep" }}
      onNodeClick={(_event, node) => {
        focusNode(node);
        void navigate({
          to: "/$orgSlug/$projectSlug/graph/$resourceId",
          params: {
            resourceId: node.id,
            orgSlug,
            projectSlug,
          },
        });
      }}
    >
      <Background gap={20} size={1} />
      <Controls
        showInteractive={false}
        position="bottom-right"
        className="!rounded-md !border !border-border/40 !bg-background/80 !shadow-sm !backdrop-blur [&_button]:!border-border/40 [&_button]:!bg-transparent [&_button]:!text-muted-foreground hover:[&_button]:!text-foreground"
      />
    </ReactFlow>
  );
}
