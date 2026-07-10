import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createFileRoute,
  Outlet,
  useChildMatches,
  useLoaderData,
  useMatch,
  useNavigate,
} from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import {
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeChange,
} from "@xyflow/react";

import {
  incrementalLayout,
  topologySignature,
  type XY,
} from "@/features/projects/components/graph/layout-graph";
import { StackCodePanel, useStackPanelState } from "@/features/projects/components/stack";
import { orpc } from "@/shared/server/orpc";

import { GraphFlow } from "./-components/graph-flow";
import { useGraphModel } from "./-components/graph-model";

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
  const { projectSlug } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  // Drawer state (open/tab/height, persisted per project) lives here so the
  // canvas can lift its bottom-anchored chrome above the drawer's footprint.
  const panel = useStackPanelState(project.id);

  return (
    <div className="relative flex flex-1 overflow-hidden p-3">
      <div className="relative flex-1 overflow-hidden rounded-2xl border">
        <ReactFlowProvider>
          <GraphCanvas bottomInset={panel.occupiedHeight} />
          <div className="pointer-events-none absolute inset-0 top-10 z-10 flex size-full items-end justify-end">
            <AnimatePresence mode="wait">
              {childKey ? <Outlet key={childKey} /> : null}
            </AnimatePresence>
          </div>
          <StackCodePanel projectId={project.id} projectSlug={projectSlug} panel={panel} />
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

type SetCenter = ReturnType<typeof useReactFlow>["setCenter"];

// Slide the camera so a clicked node lands centered in the visible left strip
// (the (1 - PANEL_WIDTH_RATIO) area not covered by the detail panel). Measures
// the real `.react-flow` wrapper rather than the window so the sidebar + chrome
// don't skew the offset; with no measurable canvas it centers honestly.
function focusNodeInView(node: Node, setCenter: SetCenter) {
  const wrapper = document.querySelector(".react-flow");
  const canvasWidth = wrapper?.clientWidth ?? 0;
  // Center on the node's real size (React Flow v12 measures after layout) so a
  // 256px preview satellite isn't offset by the 420px resource-card constants.
  const w = node.measured?.width ?? CARD_W;
  const h = node.measured?.height ?? CARD_H;
  const targetX = node.position.x + w / 2;
  const targetY = node.position.y + h / 2;
  if (!canvasWidth) {
    void setCenter(targetX, targetY, { zoom: FOCUS_ZOOM, duration: 400 });
    return;
  }
  const shiftRatio = PANEL_WIDTH_RATIO / 2;
  const xOffset = (canvasWidth * shiftRatio) / FOCUS_ZOOM;
  void setCenter(targetX + xOffset, targetY, {
    zoom: FOCUS_ZOOM,
    duration: 400,
  });
}

/** Whether a right-hand detail panel (resource or preview) is open — and,
 *  on the open→closed transition, refit the whole graph into view so the
 *  user gets the wide overview instead of staying parked on the
 *  previously-focused node. */
function useDetailPanelRefit(fitView: ReturnType<typeof useReactFlow>["fitView"]): boolean {
  const resourceMatch = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId",
    shouldThrow: false,
  });
  const previewMatch = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug/graph/preview/$previewId",
    shouldThrow: false,
  });
  const panelOpen = !!resourceMatch || !!previewMatch;
  const wasOpen = useRef(panelOpen);
  useEffect(() => {
    if (wasOpen.current && !panelOpen) {
      void fitView({ padding: 0.2, duration: 400 });
    }
    wasOpen.current = panelOpen;
  }, [panelOpen, fitView]);
  return panelOpen;
}

function GraphCanvas({ bottomInset }: { bottomInset: number }) {
  const navigate = useNavigate();
  const { orgSlug, projectSlug } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const { setCenter, fitView } = useReactFlow();

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

  const onNodesChange = useCallback((changes: NodeChange[]) => {
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
  }, []);

  // Last node set we handed React Flow. Reused while dragging so a mid-drag
  // poll can't churn the array (render-cache ref pattern, like layoutCache).
  const renderedNodesRef = useRef<Node[]>([]);

  // Distinguishes a drag from a click so a drag doesn't open the detail panel.
  // Set on drag-start, checked in onNodeClick, cleared a frame after drag-stop
  // (the synthetic click some browsers fire on mouseup runs before that frame,
  // so it still sees the flag; the next genuine click does not).
  const didDragRef = useRef(false);

  // The render-cache refs below (renderedNodesRef / layoutCache) are read and
  // written during render on purpose: mid-drag we must return the exact node
  // set we last rendered (freezing add/remove so nothing flickers out), and we
  // accumulate dagre positions across renders keyed by topology signature.
  // Promoting these to state would add render cycles and reintroduce the
  // drag-flicker/jitter this cache exists to prevent, so the refs rule is
  // scoped-off for just this memo.
  /* oxlint-disable react-hooks-js/refs -- deliberate render cache (anti-flicker); see note above */
  const laidOutNodes = useMemo(() => {
    if (dragging && renderedNodesRef.current.length > 0) {
      // Mid-drag: keep the exact node set we last rendered — only move the
      // node(s) under the cursor. No add/remove, so nothing can flicker out.
      const out = renderedNodesRef.current.map((n) => {
        const pos = dragged.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
      renderedNodesRef.current = out;
      return out;
    }
    // Preview satellites are excluded from dagre + the topology signature —
    // they hang right of their parent service card (mirroring the design
    // mock), so a PR opening/closing never relayouts the core graph.
    const core = liveNodes.filter((n) => n.data.kind !== "preview");
    const coreEdges = liveEdges.filter((e) => !e.target.startsWith("preview:"));
    const sig = topologySignature(core, coreEdges);
    if (sig !== layoutCache.current.sig) {
      layoutCache.current = {
        sig,
        positions: incrementalLayout(core, coreEdges, layoutCache.current.positions),
      };
    }
    const { positions } = layoutCache.current;
    const satelliteIndex = new Map<string, number>();
    const out = liveNodes.map((n) => {
      if (n.data.kind === "preview" && n.data.preview) {
        // A dragged position wins; otherwise stack right of the parent card.
        const dpos = dragged.get(n.id);
        if (dpos) return { ...n, position: dpos };
        const parentId = n.data.preview.parentId;
        const i = satelliteIndex.get(parentId) ?? 0;
        satelliteIndex.set(parentId, i + 1);
        const parent = dragged.get(parentId) ?? positions.get(parentId);
        if (!parent) return n;
        return {
          ...n,
          position: { x: parent.x + CARD_W + 64, y: parent.y + i * 112 },
        };
      }
      // A dragged position wins over dagre's computed one.
      const pos = dragged.get(n.id) ?? positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });
    renderedNodesRef.current = out;
    return out;
  }, [liveNodes, liveEdges, dragged, dragging]);
  /* oxlint-enable react-hooks-js/refs */

  const panelOpen = useDetailPanelRefit(fitView);

  // Re-run layout: forget every operator-dragged position (local caches +
  // the persisted project layout via `replace: true`) so the next render's
  // dagre pass owns placement again, then refit. The server write is
  // best-effort — the local reset already re-laid the graph.
  const onRelayout = useCallback(() => {
    layoutCache.current = { sig: "", positions: new Map() };
    setDragged(new Map());
    void orpc.project.saveGraphLayout
      .call({ id: project.id, positions: {}, replace: true })
      .catch(() => {});
    requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 400 });
    });
  }, [project.id, fitView]);

  return (
    <GraphFlow
      nodes={laidOutNodes}
      edges={liveEdges}
      traffic={traffic}
      onRelayout={onRelayout}
      bottomInset={bottomInset}
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
      onNodeDragStop={(_event, node) => {
        // Clear the drag flag a frame later so the synthetic click that may
        // follow mouseup still sees it (and doesn't reopen the panel).
        requestAnimationFrame(() => {
          didDragRef.current = false;
        });
        // Satellites are ephemeral (PR lifetime) — never persist their keys
        // into the shared project layout; the in-memory override holds for
        // the session.
        if (node.data.kind === "preview") return;
        // Persist the dropped position (shared per-project layout). Merged
        // server-side, so sending just this node is enough. Best-effort —
        // the in-memory override already keeps the node placed locally.
        void orpc.project.saveGraphLayout
          .call({
            id: project.id,
            positions: { [node.id]: { x: node.position.x, y: node.position.y } },
          })
          .catch(() => {});
      }}
      onNodeClick={(_event, node) => {
        // A drag just ended — don't treat its mouseup as a click that would
        // reopen the panel.
        if (didDragRef.current) return;
        // Pending-deletion nodes are disabled — no focus, no navigation.
        if (node.data.pending === "delete") return;
        // Preview satellites open the preview detail panel (deployment
        // history, logs, env overrides). The URL lives on a button in there.
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
    />
  );
}
