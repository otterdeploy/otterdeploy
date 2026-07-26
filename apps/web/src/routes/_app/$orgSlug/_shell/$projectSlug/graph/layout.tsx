import { useEffect, useMemo, useRef, useState } from "react";
import {
  createFileRoute,
  Outlet,
  useChildMatches,
  useLoaderData,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { AnimatePresence } from "motion/react";
import { ReactFlowProvider, useReactFlow, type NodeChange } from "@xyflow/react";

import { GraphContextMenu } from "@/features/projects/components/graph/graph-context-menu";
import { type XY } from "@/features/projects/components/graph/layout-graph";
import type { ResourceFlowNode } from "@/features/projects/components/graph/resource-node-types";
import { useResourceOverlay } from "@/features/projects/components/new-resource/overlay-provider";
import {
  PANEL_COLLAPSED_HEIGHT,
  StackCodePanel,
  useStackPanelState,
  type StackPanelState,
} from "@/features/projects/components/stack";
import { resourceCollection } from "@/features/resources/data/resource";
import { orpc } from "@/shared/server/orpc";

import { focusNodeInView, preloadNodeRoute, useDetailPanelRefit } from "./-components/graph-camera";
import { useGraphContextMenu } from "./-components/graph-context-menu-actions";
import { useBoundedGraph } from "./-components/graph-extent";
import { GraphFlow } from "./-components/graph-flow";
import { useGraphModel } from "./-components/graph-model";
import {
  commitNodeDrop,
  computeLaidOutNodes,
  resolveDroppedPositions,
} from "./-components/laid-out-nodes";
import { GraphPanelShell } from "./-components/panel-shell";

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/graph")({
  component: RouteComponent,
  staticData: { crumb: "Graph" },
});

function RouteComponent() {
  // AnimatePresence only sees its DIRECT children — passing <Outlet /> with
  // no key would never trigger an exit since the same element re-renders
  // on every navigation. Keying by the active immediate child match (or
  // omitting the Outlet entirely when no child is active) makes the
  // presence change visible to motion so the panel can slide out before
  // it unmounts.
  const childMatches = useChildMatches();
  const childKey = childMatches[0]?.pathname ?? null;
  const { orgSlug, projectSlug } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });

  // Whether the project has ever had any resources — drives the stack
  // drawer's first-visit-ever default (see use-panel-state). A brand-new
  // project has nothing but boilerplate YAML to show, so the drawer starts
  // collapsed instead of covering the empty-state CTA. `status` guards the
  // cold-load window so an existing project's resources (not synced yet)
  // don't get misread as "empty" and wrongly seed a collapsed default.
  const { data: resourceRows, status: resourceStatus } = useLiveQuery(
    (q) => q.from({ r: resourceCollection }).where(({ r }) => eq(r.projectId, project.id)),
    [project.id],
  );
  const hasResources = resourceStatus !== "loading" && resourceRows.length > 0;

  // Drawer state (open/tab/height, persisted per project) lives here so the
  // canvas can lift its bottom-anchored chrome above the drawer's footprint.
  const panel = useStackPanelState(project.id, hasResources);

  return (
    // No inset padding / rounded frame on a phone — at 375px the 12px gutter
    // and the border are pure loss, and the canvas wants every pixel.
    <div className="relative flex flex-1 overflow-hidden p-0 sm:p-3">
      <div className="relative flex-1 overflow-hidden border-0 sm:rounded-2xl sm:border">
        <ReactFlowProvider>
          <GraphCanvas panel={panel} />
          {/* The `top-10` gap exists to clear the floating canvas toolbar; on a
              phone the drawer covers the whole canvas instead, so it starts at
              the top edge. */}
          <div className="pointer-events-none absolute inset-0 top-0 z-10 flex size-full items-end justify-end sm:top-10">
            <AnimatePresence mode="wait">
              {childKey ? (
                // The drawer itself is OURS, not the child route's — see
                // panel-shell.tsx. The child routes set `pendingMs: 0`, so
                // `childKey` flips the moment a node is clicked and the drawer
                // starts sliding in while the child is still pending; its
                // skeleton renders inside this already-animating shell.
                <GraphPanelShell key={childKey} orgSlug={orgSlug} projectSlug={projectSlug}>
                  <Outlet />
                </GraphPanelShell>
              ) : null}
            </AnimatePresence>
          </div>
          <StackCodePanel projectId={project.id} projectSlug={projectSlug} panel={panel} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

// Applied resources carry the real resourceId on data; a pending-create ghost
// has none, so fall back to the node id (`${kind}:${name}`) — the $resourceId
// route resolves either form.
function nodeTargetId(node: { id: string; data: { resourceId?: unknown } }): string {
  const real = node.data.resourceId;
  return typeof real === "string" ? real : node.id;
}

function GraphCanvas({ panel }: { panel: StackPanelState }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { orgSlug, projectSlug } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const { setCenter, fitView } = useReactFlow();
  const overlay = useResourceOverlay();

  const { liveNodes, liveEdges, traffic } = useGraphModel(project);

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
  // Seed from the project's persisted layout so saved positions render on the
  // first paint and dagre only auto-places nodes that have never been arranged.
  const layoutCache = useRef<{ sig: string; positions: Map<string, XY> }>({
    sig: "",
    positions: new Map(Object.entries(project.graphLayout ?? {})),
  });

  // Operator drag overrides. dagre still computes the initial layout, but once
  // a node is dragged we honor that placement for the rest of the session,
  // layering it over dagre's position. React Flow is a controlled graph here
  // (we own the `nodes` prop), so a drag only sticks if we capture its position
  // change and feed it back — otherwise the next poll-driven render snaps the
  // node home. Kept in state so a drag re-renders.
  const [dragged, setDragged] = useState<Map<string, XY>>(
    () => new Map(Object.entries(project.graphLayout ?? {})),
  );
  // True while a node is actively being dragged. The graph polls every 5s
  // (diff / resources / tasks) and each poll rebuilds the node list; if one
  // lands mid-drag it swaps the node set under React Flow and the node you're
  // holding unmounts then remounts — the fast-drag flicker. While dragging we
  // freeze the rendered set so no poll can add/remove a node until you drop.
  const [dragging, setDragging] = useState(false);

  const onNodesChange = (changes: NodeChange[]) => {
    // Minimap can't draw a node it has no size for; a controlled graph only
    // learns sizes from these changes. See graph-extent.ts.
    captureDimensions(changes);
    // This graph is controlled: React Flow does NOT move the dragged node on its
    // own here — it only tracks the cursor if we feed each position change back
    // into the `nodes` prop. So we must capture per-frame positions. The cost of
    // that (re-rendering) is contained elsewhere: `laidOutNodes` keeps every
    // non-dragged node's object reference stable, and the node renderers are
    // memoized, so only the dragged card's transform updates — its contents
    // don't re-render.
    setDragged((prev) => {
      let next = prev;
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          if (next === prev) next = new Map(prev);
          next.set(c.id, c.position);
          // Mirror into the layout cache so a later incremental relayout
          // (on a real topology change) pins from where the operator left it.
          layoutCache.current.positions.set(c.id, c.position);
        }
      }
      return next;
    });
    for (const c of changes) {
      if (c.type === "position" && typeof c.dragging === "boolean") {
        setDragging(c.dragging);
      }
    }
  };

  // Last node set we handed React Flow. Reused while dragging so a mid-drag
  // poll can't churn the array (render-cache ref pattern, like layoutCache).
  const renderedNodesRef = useRef<typeof liveNodes>([]);

  // Distinguishes a drag from a click so a drag doesn't open the detail panel.
  // Set on drag-start, checked in onNodeClick, cleared a frame after drag-stop
  // (the synthetic click some browsers fire on mouseup runs before that frame,
  // so it still sees the flag; the next genuine click does not).
  const didDragRef = useRef(false);

  // Node positioning lives in ./-components/laid-out-nodes (pure, keeps this
  // component under the line/complexity caps). It reads/writes the two render-
  // cache refs during render on purpose — mid-drag we must return the exact set
  // we last rendered (no flicker) and accumulate dagre positions across renders;
  // promoting them to state reintroduces the flicker/jitter the cache prevents.
  /* oxlint-disable react-hooks-js/refs -- deliberate render cache (anti-flicker); see laid-out-nodes.ts */
  const laidOutNodes = useMemo(
    () =>
      computeLaidOutNodes({ dragging, dragged, liveNodes, liveEdges, renderedNodesRef, layoutCache }),
    [liveNodes, liveEdges, dragged, dragging],
  );
  /* oxlint-enable react-hooks-js/refs */

  // Bounded world + the strays pulled back into it — see graph-extent.ts.
  const { nodes: boundedNodes, nodeExtent, translateExtent, captureDimensions } =
    useBoundedGraph(laidOutNodes, layoutCache);

  const panelOpen = useDetailPanelRefit(fitView);

  // A resource panel (or preview/deployment overlay) is open — collapse the
  // bottom drawer so its content isn't squeezed into a ~6-line sliver behind
  // the panel. The operator's real open/closed preference is untouched in
  // storage; this only overrides what's rendered while a panel covers it.
  const effectivePanel: StackPanelState = panelOpen
    ? { ...panel, open: false, occupiedHeight: PANEL_COLLAPSED_HEIGHT }
    : panel;

  // Auto fit-view the first time any node (real or staged-ghost) appears —
  // React Flow's `fitView` prop only fires once, on the canvas's initial
  // mount, so a project that starts empty (or a fresh ghost created after
  // mount) never gets framed and the lone new card renders at whatever zoom
  // the empty canvas happened to be at (the "huge first node" glitch).
  const hadNodesRef = useRef(laidOutNodes.length > 0);
  useEffect(() => {
    const hasNodes = laidOutNodes.length > 0;
    if (hasNodes && !hadNodesRef.current) {
      requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300 }));
    }
    hadNodesRef.current = hasNodes;
  }, [laidOutNodes.length, fitView]);

  // Shared by the node click handler and the context menu's "Open" item —
  // same navigation, same pending-delete guard, same preview-satellite branch.
  const openNode = (node: ResourceFlowNode) => {
    if (node.data.pending === "delete") return;
    if (node.data.kind === "preview") {
      const preview = node.data.preview as { id?: string } | undefined;
      if (typeof preview?.id === "string" && preview.id.length > 0) {
        focusNodeInView(node, setCenter);
        void navigate({
          to: "/$orgSlug/$projectSlug/graph/preview/$previewId",
          params: { orgSlug, projectSlug, previewId: preview.id },
        });
      }
      return;
    }
    focusNodeInView(node, setCenter);
    const resourceId = nodeTargetId(node);
    void navigate({
      to: "/$orgSlug/$projectSlug/graph/$resourceId",
      params: { resourceId, orgSlug, projectSlug },
    });
  };

  // Right-click "Delete" — no new delete logic here, it just routes to the
  // Settings tab of the resource's own panel, where the existing danger-zone
  // confirm already lives (service/postgres/compose Settings tab).
  const openNodeSettings = (node: ResourceFlowNode) => {
    const resourceId = nodeTargetId(node);
    void navigate({
      to: "/$orgSlug/$projectSlug/graph/$resourceId",
      params: { resourceId, orgSlug, projectSlug },
      search: { tab: "settings" },
    });
  };

  // Right-click menus (node + empty canvas) — state/mutations live in a
  // sibling hook so this component stays under the line/complexity caps.
  const contextMenu = useGraphContextMenu({
    orgSlug,
    projectSlug,
    navigate,
    fitView,
    overlay,
    openNode,
    openNodeSettings,
  });

  // Re-run layout: forget every operator-dragged position (local caches +
  // the persisted project layout via `replace: true`) so the next render's
  // dagre pass owns placement again, then refit. The server write is
  // best-effort — the local reset already re-laid the graph.
  const onRelayout = () => {
    layoutCache.current = { sig: "", positions: new Map() };
    setDragged(new Map());
    void orpc.project.saveGraphLayout
      .call({ id: project.id, positions: {}, replace: true })
      .catch(() => {});
    requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 400 });
    });
  };

  return (
    <>
      <GraphFlow
        nodes={boundedNodes}
        nodeExtent={nodeExtent}
        translateExtent={translateExtent}
        edges={liveEdges}
        traffic={traffic}
        onRelayout={onRelayout}
        onNewService={() => overlay.setOpen(true)}
        bottomInset={effectivePanel.occupiedHeight}
        onNodesChange={onNodesChange}
        onNodeDragStart={() => {
          didDragRef.current = true;
          // Drag begins → get the right-hand detail panel out of the way.
          if (panelOpen) {
            void navigate({
              to: "/$orgSlug/$projectSlug/graph",
              params: { orgSlug, projectSlug },
            });
          }
        }}
        onNodeDragStop={(_event, node, nodes) => {
          // Clear the drag flag a frame later so the synthetic click that may
          // follow mouseup still sees it (and doesn't reopen the panel).
          requestAnimationFrame(() => {
            didDragRef.current = false;
          });
          // Bounce the dropped card(s) to the nearest clear spot so a drop never
          // leaves an overlap — moves ONLY the card(s) you dropped; every other
          // node is a fixed obstacle. Multi-select drags carry every dragged
          // node in `nodes`. Committing (local + best-effort persist) is a
          // sibling helper so this handler stays a one-liner — see
          // laid-out-nodes.ts.
          const moved = nodes.length > 0 ? nodes : [node];
          const resolved = resolveDroppedPositions(renderedNodesRef.current, moved);
          commitNodeDrop({ projectId: project.id, moved, resolved, layoutCache, setDragged });
        }}
        onNodeMouseEnter={(_event, node) => preloadNodeRoute(node, router, { orgSlug, projectSlug })}
      onNodeClick={(_event, node) => {
        // A drag just ended — don't treat its mouseup as a click that would
        // reopen the panel.
        if (didDragRef.current) return;
        // React Flow's generic handler types the node as the untyped base
        // `Node` — this canvas only ever renders `ResourceNode`, which always
        // gets `ResourceNodeData` (see nodeTypes in graph-flow.tsx).
        openNode(node as ResourceFlowNode);
      }}
      onNodeContextMenu={contextMenu.onNodeContextMenu}
      onPaneContextMenu={contextMenu.onPaneContextMenu}
    />
      <GraphContextMenu
        target={contextMenu.target}
        onOpenChange={contextMenu.onOpenChange}
        actions={contextMenu.actions}
      />
    </>
  );
}
