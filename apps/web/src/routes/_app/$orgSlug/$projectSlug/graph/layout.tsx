import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  createFileRoute,
  Outlet,
  useChildMatches,
  useLoaderData,
  useMatch,
  useNavigate,
} from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useLiveQuery } from "@tanstack/react-db";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import { eq } from "@tanstack/db";

import { useQuery } from "@tanstack/react-query";

import {
  buildLiveNodes,
  buildRouteEdges,
  type PendingByName,
} from "@/features/projects/components/graph/build-live-nodes";
import {
  clearAppliedCreate,
  useAppliedCreates,
} from "@/features/projects/components/graph/applied-creates-store";
import {
  incrementalLayout,
  topologySignature,
  type XY,
} from "@/features/projects/components/graph/layout-graph";
import { ResourceNode } from "@/features/projects/components/graph/resource-node";
import { StackCodePanel } from "@/features/projects/components/stack";
import { dependenciesCollection } from "@/features/projects/data/dependencies";
import { resourceCollection } from "@/features/resources/data/resource";
import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/graph")({
  component: RouteComponent,
  staticData: { crumb: "Graph" },
});

const nodeTypes = { resource: ResourceNode };

function RouteComponent() {
  // AnimatePresence only sees its DIRECT children — passing <Outlet /> with
  // no key would never trigger an exit since the same element re-renders
  // on every navigation. Keying by the active immediate child match (or
  // omitting the Outlet entirely when no child is active) makes the
  // presence change visible to motion so the panel can slide out before
  // it unmounts.
  const childMatches = useChildMatches();
  const childKey = childMatches[0]?.pathname ?? null;
  const { projectSlug } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });

  return (
    <div className="relative flex flex-1 overflow-hidden p-3">
      <div className="relative flex-1 overflow-hidden rounded-2xl border">
        <ReactFlowProvider>
          <GraphCanvas />
          <div className="pointer-events-none absolute inset-0 top-10 z-10 flex size-full items-end justify-end">
            <AnimatePresence mode="wait">
              {childKey ? <Outlet key={childKey} /> : null}
            </AnimatePresence>
          </div>
          <StackCodePanel projectId={project.id} projectSlug={projectSlug} />
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

  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) => eq(r.projectId, project.id)),
    [project.id],
  );

  // Edges come from parsing ${{Resource.VAR}} references in service env vars
  // server-side (project.dependencies). TanStack DB collection so the data
  // stays cached + reactive across panel open/close without a loading flash.
  const { data: dependencyEdges } = useLiveQuery(
    (q) =>
      q
        .from({ d: dependenciesCollection })
        .where(({ d }) => eq(d.projectId, project.id)),
    [project.id],
  );

  const { data: serviceTasks } = useLiveQuery(
    (q) =>
      q
        .from({ d: serviceTasksCollection })
        .where(({ d }) => eq(d.projectId, project.id)),
    [project.id],
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

  const tasksByResourceId = useMemo(() => {
    const m = new Map<string, (typeof serviceTasks)[number]["tasks"]>();
    for (const entry of serviceTasks) m.set(entry.resourceId, entry.tasks);
    return m;
  }, [serviceTasks]);

  // Pending manifest changes — overlay as ghost nodes for creates and
  // markers on existing nodes for updates/deletes. Polled on the same
  // 5s cadence as the pending-changes bar.
  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId: project.id },
      refetchInterval: 5_000,
    }),
  );

  // Create-ghosts the operator just Deployed. Kept mounted until the matching
  // resource lands in the collection so the node doesn't blink out and back
  // across the diff/collection refetch gap. See applied-creates-store.ts.
  const appliedCreates = useAppliedCreates(project.id);

  const pendingByName = useMemo<PendingByName>(() => {
    const creates: PendingByName["creates"] = [];
    const marker = new Map<string, "update" | "delete">();
    const resourceIdByName = new Map<string, string>();
    for (const r of resources) {
      if (r.type === "service" || r.type === "database") {
        resourceIdByName.set(`${r.type}:${r.name}`, r.resourceId);
      }
    }
    const createKeys = new Set<string>();
    for (const c of diff.data?.changes ?? []) {
      if (c.kind === "no-op" || c.resource === "env") continue;
      const key = `${c.resource}:${c.name}`;
      const id = resourceIdByName.get(key);
      if (c.kind === "create" && !id) {
        creates.push({ resource: c.resource, name: c.name });
        createKeys.add(key);
      } else if (id && (c.kind === "update" || c.kind === "delete")) {
        // Key by the node id (`${resource}:${name}`), which is what the node
        // carries — not the resourceId.
        marker.set(key, c.kind);
      }
    }
    // Bridge the apply gap: a create that was just Deployed but whose resource
    // hasn't streamed in yet keeps its ghost so the node stays put. Skip ones
    // diff still reports (already added) or that have already landed (the real
    // node renders for those — keys are cleared in the effect below).
    for (const key of appliedCreates) {
      if (createKeys.has(key) || resourceIdByName.has(key)) continue;
      const sep = key.indexOf(":");
      const resource = key.slice(0, sep) as "service" | "database";
      const name = key.slice(sep + 1);
      creates.push({ resource, name });
    }
    return { creates, marker };
  }, [resources, diff.data, appliedCreates]);

  // Once a just-Deployed create's resource has landed, stop bridging it so the
  // store doesn't pin a ghost over the now-real node.
  useEffect(() => {
    if (appliedCreates.size === 0) return;
    for (const r of resources) {
      if (r.type !== "service" && r.type !== "database") continue;
      const key = `${r.type}:${r.name}`;
      if (appliedCreates.has(key)) clearAppliedCreate(project.id, key);
    }
  }, [appliedCreates, resources, project.id]);

  // Convert resources to nodes + synthesize public route nodes via the
  // shared helper. See features/projects/components/graph/build-live-nodes.ts
  // for the rollup rules (error > building > running) and route handling.
  // The framework brand logo rides on each resource record (detected at build
  // time, stored on the row) — no per-service git-API lookup on render.
  const liveNodes = useMemo(
    () => buildLiveNodes(resources, tasksByResourceId, pendingByName),
    [resources, tasksByResourceId, pendingByName],
  );

  const liveEdges = useMemo(
    () => [...edgesFromDeps, ...buildRouteEdges(resources)],
    [resources, edgesFromDeps],
  );

  // Lay out with both nodes and edges so dagre ranks consumers above their
  // dependencies (routes → services → databases) — but only when the topology
  // actually changes, and even then without disturbing already-placed nodes.
  // Two problems this guards against:
  //   1. The manifest diff polls every 5s and task statuses tick constantly;
  //      re-running dagre on each one repacked the whole graph and made
  //      unrelated nodes jitter. A topology signature (node id set + edges)
  //      gates relayout to genuine add/remove only.
  //   2. Even on a real add (staging a create → a ghost node appears), a full
  //      relayout shoved existing services aside — yanking the node a detail
  //      panel was anchored on. incrementalLayout pins existing nodes and only
  //      places the new one.
  // Cached positions accumulate across topology changes; mutating a ref during
  // render is React's sanctioned render-cache pattern (idempotent per sig).
  const layoutCache = useRef<{ sig: string; positions: Map<string, XY> }>({
    sig: "",
    positions: new Map(),
  });

  const laidOutNodes = useMemo(() => {
    const sig = topologySignature(liveNodes, liveEdges);
    if (sig !== layoutCache.current.sig) {
      layoutCache.current = {
        sig,
        positions: incrementalLayout(
          liveNodes,
          liveEdges,
          layoutCache.current.positions,
        ),
      };
    }
    const { positions } = layoutCache.current;
    return liveNodes.map((n) => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });
  }, [liveNodes, liveEdges]);

  // Fully derived — no internal state, no setNodes-via-useEffect loops with
  // React Flow's store updater. Selection state is ephemeral.
  // nodesDraggable={false} + empty change handlers because dagre owns layout.
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
        // Pending-deletion nodes are disabled — no focus, no navigation.
        if (node.data.pending === "delete") return;
        focusNode(node);
        // Synthetic route nodes don't have a detail page — skip navigation.
        if (node.id.startsWith("route:")) return;
        // Applied resources carry the real resourceId on data; pending-create
        // ghosts have none, so fall back to the node id (`${kind}:${name}`).
        // The $resourceId route resolves either form — by resourceId for real
        // resources, or by `${kind}:${name}` for a ghost (against the manifest
        // diff) and across the ghost→applied handover.
        const real = node.data.resourceId;
        const resourceId = typeof real === "string" ? real : node.id;
        void navigate({
          to: "/$orgSlug/$projectSlug/graph/$resourceId",
          params: {
            resourceId,
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
        className="rounded-md! border! border-border/40! bg-background/80! shadow-sm! backdrop-blur! [&_button]:border-border/40! [&_button]:bg-transparent! [&_button]:text-muted-foreground! hover:[&_button]:text-foreground!"
      />
      {laidOutNodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-center">
          <div className="text-sm font-medium text-muted-foreground">
            No resources yet
          </div>
          <div className="text-xs text-muted-foreground/70">
            Add a service or database to see it on the graph.
          </div>
        </div>
      ) : null}
    </ReactFlow>
  );
}
