/**
 * Route shell for /graph/$resourceId. Resolves the resource from the
 * live resource collection, then dispatches to the right detail panel —
 * database / service / not-found.
 *
 * The drawer this renders into (and the close animation) belongs to the PARENT
 * graph layout — see `../-components/panel-shell`. This route only owns the
 * panel's contents, which is what lets the drawer slide in on click while this
 * route's chunk and queries are still resolving.
 *
 * AnimatePresence here drives only the deployment overlay's enter/exit when the
 * `/deployment/$deploymentId` child route mounts.
 */

import { useEffect, useRef } from "react";

import { useEscapeKey } from "@/shared/hooks/use-escape-key";

import {
  createFileRoute,
  Outlet,
  useChildMatches,
  useLoaderData,
} from "@tanstack/react-router";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import * as z from "zod";

import { AnimatePresence } from "motion/react";

import { resourceCollection } from "@/features/resources/data/resource";
import { useActiveEnvironment } from "@/features/shell/use-active-environment";
import { orpc, queryClient } from "@/shared/server/orpc";

import { GraphPanelPending, useGraphPanelClose } from "../-components/panel-shell";
import { ResourcePanel } from "./-components/resource-panel";

// Which panel tab is open. The URL owns this, so a tab is reloadable,
// shareable and reachable by back/forward. (The graph's context-menu Delete
// used to lean on that to land on the danger zone; it now confirms and deletes
// in place — see graph/-components/graph-node-delete.tsx.)
// Untyped against each panel's own tab union (they differ per kind);
// an unrecognized value falls back to that panel's default — see
// _shared/panel-tab.ts. The nested deployment overlay deliberately uses a
// separate `deploymentTab` key so the two can never overwrite each other.
const resourceSearchSchema = z.object({
  tab: z.string().optional(),
});

export const Route = createFileRoute(
  "/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId",
)({
  staticData: { crumb: "Resource" },
  component: RouteComponent,
  validateSearch: resourceSearchSchema,
  // A cold panel has two real waits: this route's code-split chunk (the panel
  // tree is big — terminal, data studio, logs) and the slow `service.get`
  // runtime view. Neither may hold the drawer back, so:
  //   - pendingMs 0 → the router commits the match on the next tick instead of
  //     waiting 150ms, so the parent's AnimatePresence mounts the drawer and it
  //     begins sliding in immediately.
  //   - pendingMinMs 0 → drops the router's 500ms *minimum* pending display, so
  //     a warm click swaps straight to real content with no skeleton flash.
  //   - pendingComponent → the panel-shaped skeleton, rendered INSIDE the
  //     already-open drawer (the shell lives in the parent route).
  // Together these replace the old behaviour: a >=650ms window whose only
  // feedback was the global RoutePending spinner tucked into the canvas corner,
  // after which the panel finally animated in.
  pendingMs: 0,
  pendingMinMs: 0,
  pendingComponent: GraphPanelPending,
  // NON-BLOCKING warm of the slow `service.get` runtime view. Read the
  // already-loaded collection synchronously and let the prefetch float, so the
  // panel renders its header/status from the collection row and fills in the
  // runtime bits as the query resolves — rather than sitting on the skeleton
  // until `service.get` returns. Best-effort: a cold collection or failed
  // inspect just means the panel does its own fetch on mount, as before.
  loader: ({ params }) => {
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

/**
 * Close the panel when the resource it is showing gets deleted.
 *
 * Deleting from inside the panel (or from the graph's context menu while it is
 * open) drops the row from the collection, `resource` goes null, and the panel
 * used to sit there rendering NotFound — telling the operator the thing they
 * just deleted cannot be found, which reads as an error rather than a result.
 *
 * Two things stop this from firing when it shouldn't. It only closes a panel
 * that HAD a resource: a genuinely bad URL was never showing one, so it still
 * gets NotFound, which is the honest answer there. And it waits a beat before
 * closing, because a staged-create ghost (`compose:rustfs`) is a client-side
 * row that is removed when apply lands the real one — if those two do not
 * happen in the same commit, the resource is briefly absent mid-handover and
 * closing on that would yank the panel out from under a deploy the operator is
 * watching. Reappearing inside the window cancels the close.
 */
function useCloseOnDelete(input: {
  resource: boolean;
  resourcesLoading: boolean;
  close: () => void;
}) {
  const { resource, resourcesLoading, close } = input;
  const everSeen = useRef(false);

  useEffect(() => {
    // The "have we ever shown this?" mark is set HERE rather than during
    // render: a ref write in the render body runs on every re-render including
    // discarded ones, which the hooks lint rightly rejects.
    if (resource) {
      everSeen.current = true;
      return;
    }
    if (resourcesLoading || !everSeen.current) return;
    const t = setTimeout(close, 400);
    return () => clearTimeout(t);
  }, [resource, resourcesLoading, close]);
}

function RouteComponent() {
  const { orgSlug, projectSlug, resourceId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  // The open tab lives in the URL (see resourceSearchSchema above). Each panel
  // validates it against its own tab union and falls back to its default.
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  // `replace` so flipping through tabs doesn't stack history entries — Back
  // from a panel should return to the graph, not walk the tabs you looked at.
  // Same choice the deployment overlay's own tab makes.
  const onTabChange = (next: string) =>
    void navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true });
  // Owned by the parent's drawer: animates the slide-out and pans the camera
  // back before the route change lands.
  const close = useGraphPanelClose();
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
  const activeEnv = useActiveEnvironment(project.id);
  const { data: resources, isLoading: resourcesLoading } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, project.id), eq(r.environmentId, activeEnv.id ?? "")),
        ),
    [project.id, activeEnv.id],
  );

  const resource =
    resources.find(
      (r) =>
        r.resourceId === resourceId || `${r.type}:${r.name}` === resourceId,
    ) ?? null;

  useCloseOnDelete({ resource: resource !== null, resourcesLoading, close });
  // Only when nothing is stacked on top — the deployment overlay answers
  // Escape itself, and both firing would skip a level.
  useEscapeKey(deploymentKey === null, close);

  return (
    <>
      <ResourcePanel
        resource={resource}
        resourceId={resourceId}
        resourcesLoading={resourcesLoading}
        project={project}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        tab={tab}
        onTabChange={onTabChange}
        onClose={close}
      />

      <AnimatePresence mode="wait">
        <div className="contents" key={deploymentKey}>
          <Outlet />
        </div>
      </AnimatePresence>
    </>
  );
}
