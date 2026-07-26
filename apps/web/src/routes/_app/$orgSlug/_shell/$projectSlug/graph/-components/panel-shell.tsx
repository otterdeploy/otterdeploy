/**
 * The right-hand drawer every graph detail panel renders inside (resource,
 * PR preview).
 *
 * It deliberately lives in the GRAPH layout — the parent route, whose chunk is
 * already loaded by the time you can click a node — not in the code-split
 * `$resourceId` / `preview/$previewId` children. So a node click slides the
 * drawer in on the same frame, and the child's route chunk plus its
 * `service.get` / manifest queries fill in behind a skeleton.
 *
 * Before this, the drawer's motion.div was owned by the child route: nothing
 * appeared until that chunk AND its loader had resolved, and with the router's
 * `defaultPendingMs: 150` + `defaultPendingMinMs: 500` the only feedback in
 * that window was the tiny global RoutePending spinner — dropped into the
 * bottom-right corner of the canvas where nobody notices it. The panel then
 * animated in *after* the wait, which read as "click, nothing, jump".
 *
 * The shell also owns the close choreography, because that has to outlive the
 * child: `close()` animates the drawer out and pans the graph back to its
 * overview at the same time, and only navigates once the slide-out finishes.
 * Navigating first would make TanStack's <Outlet> render null immediately,
 * leaving the exit animation nothing to animate — the panel would just vanish.
 * Children reach it via {@link useGraphPanelClose}.
 */

import { createContext, useContext, useState, type ReactNode } from "react";

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { useNavigate } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import * as m from "motion/react-client";

import { ResourcePanelSkeleton } from "@/features/resources/components/_shared/panel-skeleton";

const noop = () => {};

const GraphPanelCloseContext = createContext<() => void>(noop);

/**
 * Close the containing graph drawer — animated slide-out, then the route
 * change. Available to anything rendered inside {@link GraphPanelShell},
 * including a route's `pendingComponent`, so the close button works while the
 * panel is still loading.
 */
export function useGraphPanelClose(): () => void {
  return useContext(GraphPanelCloseContext);
}

/**
 * Skeleton shown while a graph detail route's chunk/data resolves. Rendered as
 * the child routes' `pendingComponent` (with `pendingMs: 0`), so it appears
 * inside the drawer that is already sliding in rather than replacing it.
 */
export function GraphPanelPending() {
  const close = useGraphPanelClose();
  return <ResourcePanelSkeleton onClose={close} />;
}

export function GraphPanelShell({
  orgSlug,
  projectSlug,
  children,
}: {
  orgSlug: string;
  projectSlug: ProjectSlug;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  // Same ReactFlow instance the canvas uses (shared provider) — lets close pan
  // the graph back to the overview AT THE SAME TIME the drawer slides out,
  // instead of after the route change (which now waits for the slide-out).
  const { fitView } = useReactFlow();
  // Drives the slide-OUT. See the file header for why we can't just navigate.
  const [closing, setClosing] = useState(false);

  const close = () => {
    setClosing(true);
    // Same 400ms as the drawer spring's settle. The route-change refit in
    // useDetailPanelRefit still fires when navigation lands, but by then the
    // camera is already there — so it's a no-op, not a second delayed pan.
    void fitView({ padding: 0.2, duration: 400 });
  };

  return (
    <m.div
      initial={{ x: "100%" }}
      animate={{ x: closing ? "100%" : 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      onAnimationComplete={() => {
        // Only the close (slide-out) navigates; the mount slide-in completes
        // with closing=false and is a no-op. By now the drawer is fully
        // off-screen, so the route unmount is invisible.
        if (closing) void navigate({ to: "/$orgSlug/$projectSlug/graph", params: { orgSlug, projectSlug } });
      }}
      className="pointer-events-auto relative h-full w-full rounded-lg rounded-tr-none border border-r-0 border-border bg-card lg:w-4/5 xl:w-3/5"
    >
      <GraphPanelCloseContext.Provider value={close}>{children}</GraphPanelCloseContext.Provider>
    </m.div>
  );
}
