import { useEffect, useRef } from "react";
import { CodeIcon, Database02Icon, FlashIcon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import {
  createFileRoute,
  Outlet,
  useMatch,
  useNavigate,
} from "@tanstack/react-router";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import {
  ResourceNode,
  type ResourceNodeData,
} from "@/features/projects/components/graph/resource-node";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/graph")({
  component: RouteComponent,
  staticData: { crumb: "Graph" },
});

const nodeTypes = { resource: ResourceNode };

// Layout: 3 columns × 4 rows. Cards are 420px wide; allow ~60px gap horizontally.
// Row 3 (databases with MOUNTS trays) sits taller so it gets extra vertical room.
const COL = [0, 480, 960];
const ROW = [0, 280, 600, 940];

const initialNodes: Node<ResourceNodeData>[] = [
  // Row 1 — services, three statuses
  {
    id: "api",
    type: "resource",
    position: { x: COL[0], y: ROW[0] },
    data: {
      kind: "service",
      name: "api",
      description:
        "Public-facing API for the web client. Handles auth, oRPC routes, and Inngest triggers.",
      status: "running",
      tech: { label: "Bun 1.3", icon: FlashIcon },
    },
  },
  {
    id: "worker",
    type: "resource",
    position: { x: COL[1], y: ROW[0] },
    data: {
      kind: "service",
      name: "worker",
      description: "Background job runner. Processes Inngest events and long-running tasks.",
      status: "building",
      tech: { label: "Node 22", icon: CodeIcon },
    },
  },
  {
    id: "imgproxy",
    type: "resource",
    position: { x: COL[2], y: ROW[0] },
    data: {
      kind: "service",
      name: "imgproxy",
      description: "Image resizing and optimization proxy. Cached at the edge.",
      status: "error",
      tech: { label: "Go 1.23", icon: ServerStack01Icon },
    },
  },

  // Row 2 — service without status, service without tech footer
  {
    id: "web",
    type: "resource",
    position: { x: COL[0], y: ROW[1] },
    data: {
      kind: "service",
      name: "web",
      description: "Marketing site and dashboard shell. SSR via TanStack Start.",
      tech: { label: "Bun 1.3", icon: FlashIcon },
    },
  },
  {
    id: "cron",
    type: "resource",
    position: { x: COL[1], y: ROW[1] },
    data: {
      kind: "service",
      name: "nightly-cleanup",
      description: "Sweeps stale uploads and rotates audit logs every night at 03:00 UTC.",
      status: "running",
    },
  },
  {
    id: "docker-custom",
    type: "resource",
    position: { x: COL[2], y: ROW[1] },
    data: {
      kind: "service",
      name: "vector-bridge",
      engine: "docker",
      description:
        "Custom Docker image — pulls vectors from upstream and writes to the search index.",
      status: "running",
      tech: { label: "Custom OCI image" },
    },
  },

  // Row 3 — databases with brand engines, three statuses + 3 volume variants
  // Variant A (inline): postgres carries its volumes inside the card body.
  {
    id: "postgres",
    type: "resource",
    position: { x: COL[0], y: ROW[2] },
    data: {
      kind: "database",
      name: "postgres",
      engine: "postgres",
      description: "Primary application database. Schema managed via Drizzle migrations.",
      status: "running",
      tech: { label: "Postgres 16", icon: Database02Icon },
      volumes: [{ name: "pgdata", size: "50 GB", mount: "/var/lib/postgresql/data" }],
    },
  },
  {
    id: "redis",
    type: "resource",
    position: { x: COL[1], y: ROW[2] },
    data: {
      kind: "database",
      name: "redis",
      engine: "redis",
      description: "Session cache, rate-limit counters, and Inngest queue backing store.",
      status: "building",
      tech: { label: "Redis 7.4", icon: Database02Icon },
      volumes: [{ name: "redis-aof", size: "5 GB", mount: "/data" }],
    },
  },
  // Inline Mounts grid — 3 mounts, so they lay out in 2 columns.
  {
    id: "mongo",
    type: "resource",
    position: { x: COL[2], y: ROW[2] },
    data: {
      kind: "database",
      name: "events",
      engine: "mongodb",
      description: "Event log store — append-only, replicated across two regions.",
      status: "error",
      tech: { label: "MongoDB 7.0", icon: Database02Icon },
      volumes: [
        { name: "events-data", size: "200 GB" },
        { name: "events-wal", size: "50 GB" },
        { name: "events-backup", size: "1 TB" },
      ],
    },
  },

  // Row 4 — extra engines + a route
  {
    id: "mysql",
    type: "resource",
    position: { x: COL[0], y: ROW[3] },
    data: {
      kind: "database",
      name: "legacy",
      engine: "mysql",
      description: "Legacy MySQL replica kept around for the importer until the cutover.",
      status: "running",
      tech: { label: "MySQL 8.4", icon: Database02Icon },
    },
  },
  {
    id: "mariadb",
    type: "resource",
    position: { x: COL[1], y: ROW[3] },
    data: {
      kind: "database",
      name: "analytics",
      engine: "mariadb",
      description: "Analytics warehouse — column store with daily rollups.",
      tech: { label: "MariaDB 11.4", icon: Database02Icon },
    },
  },
  {
    id: "route-public",
    type: "resource",
    position: { x: COL[2], y: ROW[3] },
    data: {
      kind: "route",
      name: "api.otterstack.dev",
      description: "Public route → api service. Terminates TLS, no edge cache.",
      status: "running",
    },
  },
];

const initialEdges: Edge[] = [
  { id: "web-api", source: "web", target: "api" },
  { id: "api-postgres", source: "api", target: "postgres" },
  { id: "api-redis", source: "api", target: "redis" },
  { id: "api-mongo", source: "api", target: "mongo" },
  { id: "worker-redis", source: "worker", target: "redis" },
  { id: "worker-postgres", source: "worker", target: "postgres" },
  { id: "web-imgproxy", source: "web", target: "imgproxy" },
  { id: "cron-postgres", source: "cron", target: "postgres" },
  { id: "docker-mongo", source: "docker-custom", target: "mongo" },
  { id: "api-mysql", source: "api", target: "mysql" },
  { id: "worker-mariadb", source: "worker", target: "mariadb" },
  { id: "route-api", source: "route-public", target: "api" },
];

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
  const { setCenter, fitView } = useReactFlow();

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
    const wrapper = document.querySelector(".react-flow") as HTMLElement | null;
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
      defaultNodes={initialNodes}
      defaultEdges={initialEdges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
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
      <Background gap={20} size={1}  />
      {/* <Controls
        showInteractive={false}
        className="rounded-md border border-border/40 bg-background/80 shadow-sm backdrop-blur"
      /> */}
    </ReactFlow>
  );
}
