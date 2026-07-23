import { useMemo, useRef, useState } from "react";
import {
  createFileRoute,
  Outlet,
  useChildMatches,
  useLoaderData,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { ReactFlowProvider, useReactFlow, type NodeChange } from "@xyflow/react";

import { type XY } from "@/features/projects/components/graph/layout-graph";
import { StackCodePanel, useStackPanelState } from "@/features/projects/components/stack";
import { orpc } from "@/shared/server/orpc";

import { focusNodeInView, useDetailPanelRefit } from "./-components/graph-camera";
import { GraphFlow } from "./-components/graph-flow";
import { useGraphModel } from "./-components/graph-model";
import { computeLaidOutNodes, resolveDroppedPositions } from "./-components/laid-out-nodes";

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

// Applied resources carry the real resourceId on data; a pending-create ghost
// has none, so fall back to the node id (`${kind}:${name}`) — the $resourceId
// route resolves either form.
function nodeTargetId(node: { id: string; data: { resourceId?: unknown } }): string {
  const real = node.data.resourceId;
  return typeof real === "string" ? real : node.id;
}

function GraphCanvas({ bottomInset }: { bottomInset: number }) {
  const navigate = useNavigate();
  const router = useRouter();
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

  const onNodesChange = (changes: NodeChange[]) => {
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

  const panelOpen = useDetailPanelRefit(fitView);

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
      onNodeDragStop={(_event, node, nodes) => {
        // Clear the drag flag a frame later so the synthetic click that may
        // follow mouseup still sees it (and doesn't reopen the panel).
        requestAnimationFrame(() => {
          didDragRef.current = false;
        });

        // Bounce the dropped card(s) to the nearest clear spot so a drop never
        // leaves an overlap. This runs ONCE, here on release — never per render —
        // and moves ONLY the card(s) you dropped; every other node is a fixed
        // obstacle, so nothing else shifts. Multi-select drags carry every
        // dragged node in `nodes`.
        const moved = nodes.length > 0 ? nodes : [node];
        // Bounce the dropped card(s) to the nearest clear spot (collision over
        // the core cards only; every other node is a fixed obstacle).
        const resolved = resolveDroppedPositions(renderedNodesRef.current, moved);

        // Commit the resolved (clear) position(s) locally so the card renders and
        // stays exactly there.
        setDragged((prev) => {
          const next = new Map(prev);
          for (const m of moved) {
            const pos = resolved.get(m.id) ?? m.position;
            next.set(m.id, pos);
            // Mirror real (non-satellite) nodes into the layout cache so a later
            // incremental relayout pins from where the card ended up.
            if (m.data.kind !== "preview") {
              layoutCache.current.positions.set(m.id, pos);
            }
          }
          return next;
        });

        // Persist the resolved position(s) (shared per-project layout, merged
        // server-side). Satellites are ephemeral (PR lifetime) — never persisted.
        // Best-effort — the in-memory override already keeps the card placed.
        const persist = moved.filter((m) => m.data.kind !== "preview");
        if (persist.length > 0) {
          void orpc.project.saveGraphLayout
            .call({
              id: project.id,
              positions: Object.fromEntries(
                persist.map((m) => {
                  const p = resolved.get(m.id) ?? m.position;
                  return [m.id, { x: p.x, y: p.y }];
                }),
              ),
            })
            .catch(() => {});
        }
      }}
      onNodeMouseEnter={(_event, node) => {
        // Preload the panel route's code-split chunk (and float its data
        // prefetch, wired in that route's loader) on hover, so a subsequent
        // click mounts the drawer with no network wait. Mirrors the target
        // computation in onNodeClick below. Best-effort — a rejected/cancelled
        // preload must never surface.
        if (node.data.pending === "delete") return;
        if (node.data.kind === "preview") {
          const preview = node.data.preview as { id?: string } | undefined;
          if (typeof preview?.id === "string" && preview.id.length > 0) {
            void router
              .preloadRoute({
                to: "/$orgSlug/$projectSlug/graph/preview/$previewId",
                params: { orgSlug, projectSlug, previewId: preview.id },
              })
              .catch(() => {});
          }
          return;
        }
        const resourceId = nodeTargetId(node);
        void router
          .preloadRoute({
            to: "/$orgSlug/$projectSlug/graph/$resourceId",
            params: { resourceId, orgSlug, projectSlug },
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
        // Applied resources carry the real resourceId on data; pending-create
        // ghosts have none, so fall back to the node id (`${kind}:${name}`).
        // The $resourceId route resolves either form — by resourceId for real
        // resources, or by `${kind}:${name}` for a ghost (against the manifest
        // diff) and across the ghost→applied handover.
        const resourceId = nodeTargetId(node);
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
