/**
 * Route shell for /graph/$resourceId. Resolves the resource from the
 * live resource collection, then dispatches to the right detail panel —
 * database / service / not-found.
 *
 * AnimatePresence drives the deployment overlay's enter/exit when the
 * `/deployment/$deploymentId` child route mounts. The outer motion.div
 * is keyed by resourceId so navigating between resources slides the
 * whole panel rather than mutating in place.
 */

import { useState } from "react";

import {
  createFileRoute,
  Outlet,
  useChildMatches,
  useLoaderData,
} from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";
import * as z from "zod";

import { useReactFlow } from "@xyflow/react";

import * as m from "motion/react-client";
import { AnimatePresence } from "motion/react";

import { resourceCollection } from "@/features/resources/data/resource";
import { orpc, queryClient } from "@/shared/server/orpc";

import { ResourcePanel } from "./-components/resource-panel";

// Optional deep-link into a specific panel tab — e.g. the graph node context
// menu's "Delete" routes here with `tab: "settings"` so it lands straight on
// the danger-zone/staged-delete confirm instead of the panel's own default
// tab. Untyped against each panel's own tab union (they differ per kind) —
// an unrecognized value is just ignored by the panel's own validation.
const resourceSearchSchema = z.object({
  tab: z.string().optional(),
});

export const Route = createFileRoute(
  "/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId",
)({
  staticData: { crumb: "Resource" },
  component: RouteComponent,
  validateSearch: resourceSearchSchema,
  // NON-BLOCKING warm of the slow `service.get` runtime view. It MUST NOT await:
  // awaiting puts the route into its pending state, which renders a separate
  // frame BEFORE the panel's own AnimatePresence drawer mounts — so the drawer
  // slid in from the side a second time after the skeleton flashed. Read the
  // already-loaded collection synchronously and let the prefetch float, so the
  // panel mounts (and animates) exactly once and populates in place as the
  // query resolves. Best-effort: a cold collection or failed inspect just means
  // the panel does its own fetch on mount, as before.
  loader: ({ params,  }) => {
    const resource = resourceCollection.toArray.find(
      (r) => r.resourceId === params.resourceId || `${r.type}:${r.name}` === params.resourceId,
    );
    if (resource?.type === "service" && resource.resourceId) {
      void queryClient
        .prefetchQuery(
          orpc.service.get.queryOptions({
            input: {
              projectId: resource.projectId,
              resourceId: resource.resourceId,
            },
          }),
        )
        .catch(() => undefined);
    }
  },
});

function RouteComponent() {
  const { orgSlug, projectSlug, resourceId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const navigate = Route.useNavigate();
  // Deep-link into a specific tab (e.g. the graph node context menu's
  // "Delete" — see resourceSearchSchema above). Each panel validates it
  // against its own tab union and falls back to its usual default.
  const { tab: initialTab } = Route.useSearch();
  // Drives the slide-OUT. Closing the panel navigates away, which makes
  // TanStack's <Outlet> render null immediately — so the unmount-time `exit`
  // animation has nothing left to animate and the panel just vanishes. Instead
  // we animate to x:"100%" on `closing`, then navigate once that finishes (see
  // onAnimationComplete on the drawer below).
  const [closing, setClosing] = useState(false);
  // Same ReactFlow instance the canvas uses (shared provider) — lets close
  // pan the graph back to the overview AT THE SAME TIME the panel slides out,
  // instead of after the route change (which now waits for the slide-out).
  const { fitView } = useReactFlow();
  // Key the inner Outlet by the active child match so AnimatePresence
  // sees the deployment overlay come and go. Without this the same
  // <Outlet /> element renders for every navigation and the exit never
  // fires.
  const childMatches = useChildMatches();
  const deploymentKey = childMatches[0]?.pathname ?? null;

  // Scope to the project and resolve in JS so a single param can match either
  // form the graph navigates with: the real `resourceId` (applied resources),
  // or `${kind}:${name}` (a staged-create ghost, and the URL that lingers
  // across the ghost→applied handover — same collection GraphCanvas loads, so
  // no extra fetch).
  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) => eq(r.projectId, project.id)),
    [project.id],
  );

  const resource =
    resources.find(
      (r) =>
        r.resourceId === resourceId || `${r.type}:${r.name}` === resourceId,
    ) ?? null;

  const close = () => {
    setClosing(true);
    // Pan back to the wide overview in lockstep with the slide-out (same 400ms
    // as the drawer spring settle). The route-change refit in useDetailPanelRefit
    // still fires when navigation lands, but by then the camera is already
    // there, so it's a no-op — no second, delayed pan.
    void fitView({ padding: 0.2, duration: 400 });
  };

  return (
    <m.div
      key={resourceId}
      initial={{ x: "100%" }}
      animate={{ x: closing ? "100%" : 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      onAnimationComplete={() => {
        // Only the close (slide-out) animation navigates; the mount slide-in
        // completes with closing=false and is a no-op. By now the drawer is
        // fully off-screen, so the route unmount is invisible.
        if (closing) void navigate({ to: "/$orgSlug/$projectSlug/graph" });
      }}
      className="pointer-events-auto relative h-full w-full bg-card rounded-lg rounded-tr-none border border-r-0 border-border lg:w-4/5 xl:w-3/5"
    >
      <ResourcePanel
        resource={resource}
        resourceId={resourceId}
        project={project}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        initialTab={initialTab}
        onClose={close}
      />

      <AnimatePresence mode="wait">
        <div className="contents" key={deploymentKey}>
        <Outlet />
        </div>
      </AnimatePresence>
    </m.div>
  );
}
