import { useCallback, useEffect, useMemo, useRef } from "react";
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
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import { layoutGraph } from "@/features/projects/components/graph/layout-graph";
import {
  ResourceNode,
  type ResourceNodeData,
} from "@/features/projects/components/graph/resource-node";
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

  // Live replica state per service. Polled every 5s so the REPLICAS tray on
  // each service node stays current as the swarm converges.
  const { data: serviceTasks = [] } = useQuery({
    ...orpc.project.serviceTasks.queryOptions({
      input: { projectId: project.id },
    }),
    refetchInterval: 5000,
  });

  const edgesFromDeps = useMemo<Edge[]>(
    () =>
      dependencyEdges.map((d) => ({
        id: `${d.source}->${d.target}`,
        source: d.source,
        target: d.target,
      })),
    [dependencyEdges],
  );

  const tasksByResourceId = useMemo(() => {
    const m = new Map<string, (typeof serviceTasks)[number]["tasks"]>();
    for (const entry of serviceTasks) m.set(entry.resourceId, entry.tasks);
    return m;
  }, [serviceTasks]);

  // Convert resources to nodes, then enrich service nodes with their live
  // replicas + rolled-up status. The rollup picks the most concerning state
  // across replicas (error > building > running) so the header pill matches
  // operator intuition — one failing replica makes the whole service "error".
  //
  // Synthetic route nodes (D.5): every service with publicEnabled + a domain
  // gets a virtual "route" node added in front of it, with an edge
  // route → service so the graph shows the ingress path.
  const liveNodes = useMemo<Node<ResourceNodeData, "resource">[]>(() => {
    const out: Node<ResourceNodeData, "resource">[] = [];
    for (const r of resources) {
      const node = resourceToNode(r);
      if (node.data.kind === "service") {
        const tasks = tasksByResourceId.get(node.id);
        if (tasks && tasks.length > 0) {
          const rolledStatus = tasks.some((t) => t.state === "error")
            ? "error"
            : tasks.some((t) => t.state === "building")
              ? "building"
              : "running";
          node.data = {
            ...node.data,
            status: rolledStatus,
            replicas: tasks.map((t) => ({ label: t.label, status: t.state })),
          };
        }
        // D.5: synthesise the route node for services exposed publicly.
        if (r.type === "service" && r.publicEnabled && r.publicDomain) {
          out.push({
            id: `route:${r.resourceId}`,
            type: "resource",
            position: { x: 0, y: 0 },
            data: {
              kind: "route",
              name: r.publicDomain,
              description: `Public route → ${r.name}`,
              status: node.data.status,
            },
          });
        }
      }
      out.push(node);
    }
    return out;
  }, [resources, tasksByResourceId]);

  // Route → service edges, derived alongside the synthetic nodes so the layout
  // ranks routes above the services they front.
  const liveEdges = useMemo<Edge[]>(() => {
    const routeEdges: Edge[] = [];
    for (const r of resources) {
      if (r.type === "service" && r.publicEnabled && r.publicDomain) {
        routeEdges.push({
          id: `route:${r.resourceId}->${r.resourceId}`,
          source: `route:${r.resourceId}`,
          target: r.resourceId,
        });
      }
    }
    return [...edgesFromDeps, ...routeEdges];
  }, [resources, edgesFromDeps]);

  // Lay out with both nodes and edges so dagre ranks consumers above their
  // dependencies (routes → services → databases).
  const laidOutNodes = useMemo(
    () => layoutGraph(liveNodes, liveEdges),
    [liveNodes, liveEdges],
  );

  // Fully derived — no internal state, no setNodes-via-useEffect loops with
  // React Flow's store updater. Selection state is ephemeral; positions are
  // re-derived from dagre on every data change. nodesDraggable={false} +
  // empty change handlers because dagre owns layout.
  const noopChange = useCallback(() => {}, []);

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
      nodes={laidOutNodes}
      edges={liveEdges}
      onNodesChange={noopChange}
      onEdgesChange={noopChange}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: "smoothstep" }}
      onNodeClick={(_event, node) => {
        focusNode(node);
        // Synthetic route nodes don't have a detail page — skip navigation.
        if (node.id.startsWith("route:")) return;
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
