/**
 * Route shell for /projects/$project/$env/r/$resourceId. Resolves the resource from the
 * live resource collection, then dispatches to the right detail panel.
 * Database / service / not-found.
 *
 * The drawer this renders into (and the close animation) belongs to the PARENT
 * graph layout: see `../-components/panel-shell`. This route only owns the
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
  useParams,
} from "@tanstack/react-router";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import * as z from "zod";

import { AnimatePresence } from "motion/react";

import { envCollection } from "@/features/projects/data/env";
import { resourceCollection } from "@/features/resources/data/resource";
import { inActiveEnvironment } from "@/features/shell/environment-scope";
import { isMainEnvironment } from "@/features/shell/environment-default";
import { useActiveEnvironment } from "@/features/shell/use-active-environment";
import { orpc, queryClient } from "@/shared/server/orpc";
import { useRouteView } from "@/shared/hooks/use-route-view";
import {
  type PanelFocusPatch,
  panelLocationFromView,
  panelTarget,
} from "@/features/resources/components/_shared/panel-location";
import {
  PANEL_LOG_PATHS,
  panelTabPath,
} from "@/features/resources/components/_shared/panel-routes";

import { GraphPanelPending, useGraphPanelClose } from "../../../-components/panel-shell";
import { ResourcePanel } from "./-components/resource-panel";

// Which panel tab is open is the child route: `…/r/$id` (the panel's default
// tab), `/deployments[/$deploymentId]`, `/logs[/build|/deploy]`, `/variables`,
// `/settings`, `/metrics`, `/terminal`, `/data`, `/compose`. Each child
// declares its `view`; see features/resources/components/_shared/panel-location.
// Untyped against each panel's own tab union (they differ per kind); an
// unrecognized value falls back to that panel's default. See
// _shared/panel-tab.ts.
const resourceSearchSchema = z.object({
  /** The deployment whose build/deploy log the Logs tab shows. On the
   *  Deployments tab the focused deployment is a path segment instead. */
  deployment: z.string().optional(),
});

export const Route = createFileRoute(
  "/_app/$orgSlug/_shell/projects/$projectSlug/_canvas/$envSlug/r/$resourceId",
)({
  staticData: { crumb: "Resource", drawer: true },
  component: RouteComponent,
  validateSearch: resourceSearchSchema,
  // A cold panel has two real waits: this route's code-split chunk (the panel
  // tree is big. Terminal, data studio, logs) and the slow `service.get`
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
  // runtime bits as the query resolves. Rather than sitting on the skeleton
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
 * used to sit there rendering NotFound. Telling the operator the thing they
 * just deleted cannot be found, which reads as an error rather than a result.
 *
 * Two things stop this from firing when it shouldn't. It only closes a panel
 * that HAD a resource: a genuinely bad URL was never showing one, so it still
 * gets NotFound, which is the honest answer there. And it waits a beat before
 * closing, because a staged-create ghost (`compose:rustfs`) is a client-side
 * row that is removed when apply lands the real one. If those two do not
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
  const { orgSlug, projectSlug, envSlug, resourceId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/projects/$projectSlug" });
  const navigate = Route.useNavigate();
  // The open tab, the expanded deployment and the log source are the child
  // route. `replace` throughout so flipping through tabs doesn't stack
  // history entries: Back from a panel returns to the graph, not through the
  // tabs you looked at.
  const view = useRouteView();
  const { deploymentId } = useParams({ strict: false });
  const { deployment: deploymentSearch } = Route.useSearch();
  const location = panelLocationFromView(view, { deploymentId, deploymentSearch });
  const params = { orgSlug, projectSlug, envSlug, resourceId };
  const go = (next: PanelFocusPatch) => {
    const target = panelTarget(location, next);
    if (target.kind === "deployment") {
      void navigate({
        to: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/deployments/$deploymentId",
        params: { ...params, deploymentId: target.deploymentId },
        replace: true,
      });
      return;
    }
    if (target.kind === "logs") {
      const search = { deployment: target.deployment ?? undefined };
      if (target.source === "build") {
        void navigate({ to: PANEL_LOG_PATHS.build, params, search, replace: true });
      } else if (target.source === "deploy") {
        void navigate({ to: PANEL_LOG_PATHS.deploy, params, search, replace: true });
      } else {
        void navigate({ to: PANEL_LOG_PATHS.runtime, params, search, replace: true });
      }
      return;
    }
    void navigate({ to: panelTabPath(target.tab), params, replace: true });
  };
  const onTabChange = (next: string) => go({ tab: next });
  // Owned by the parent's drawer: animates the slide-out and pans the camera
  // back before the route change lands.
  const close = useGraphPanelClose();
  // Key the inner Outlet by the active child match so AnimatePresence
  // sees the deployment overlay come and go. Without this the same
  // <Outlet /> element renders for every navigation and the exit never
  // fires.
  // Only the preview deployment overlay renders anything here; the tab routes
  // are markers. See ./deployments/$deploymentId.tsx.
  const childMatches = useChildMatches();
  const overlayMatch = childMatches.find(
    (m) => m.staticData.overlay === true && "previewId" in m.search && Boolean(m.search.previewId),
  );
  const deploymentKey = overlayMatch?.pathname ?? null;

  // Scope to the project and resolve in JS so a single param can match either
  // form the graph navigates with: the real `resourceId` (applied resources),
  // or `${kind}:${name}` (a staged-create ghost, and the URL that lingers
  // across the ghost→applied handover. Same collection GraphCanvas loads, so
  // no extra fetch).
  const activeEnv = useActiveEnvironment(project.id);
  const { data: resources, isLoading: resourcesLoading } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, project.id), inActiveEnvironment(r.environmentId, activeEnv)),
        ),
    [project.id, activeEnv.id, activeEnv.isMain],
  );

  const resource =
    resources.find(
      (r) =>
        r.resourceId === resourceId || `${r.type}:${r.name}` === resourceId,
    ) ?? null;

  // Self-correct the environment rather than claim the resource is missing.
  //
  // A resource id belongs to exactly ONE environment, but plenty of surfaces
  // legitimately link across them: the header activity list, the volumes and
  // backups tables, a server's service list. Landing here with the wrong
  // `?env=` produced "Resource not found" for something that plainly exists —
  // the activity popover showed a build as running while this panel said its
  // resource did not exist.
  //
  // Fixing it per-link means fixing every link, and missing the next one. The
  // route knows which environment the id is in, so it moves the operator there
  // instead. `replace` keeps Back working: the corrected URL takes the place
  // of the wrong one rather than adding a step that bounces on return.
  const { data: elsewhere } = useLiveQuery(
    (q) => q.from({ r: resourceCollection }).where(({ r }) => eq(r.projectId, project.id)),
    [project.id],
  );
  const { data: environments } = useLiveQuery((q) => q.from({ e: envCollection }), []);
  useEffect(() => {
    if (resource !== null || resourcesLoading) return;
    const found = elsewhere.find(
      (r) => r.resourceId === resourceId || `${r.type}:${r.name}` === resourceId,
    );
    if (!found) return;
    const target = environments.find((e) => e.id === found.environmentId);
    // An unstamped resource belongs to main.
    const mainEnv = environments.find((e) => isMainEnvironment(e, project.environmentId));
    const nextEnv = target?.slug ?? mainEnv?.slug;
    const currentEnv = envSlug;
    if (nextEnv === currentEnv) return;
    if (!nextEnv) return;
    void navigate({
      params: (prev) => ({ ...prev, envSlug: nextEnv }),
      replace: true,
    });
  }, [
    resource,
    resourcesLoading,
    elsewhere,
    environments,
    resourceId,
    project,
    envSlug,
    navigate,
  ]);

  useCloseOnDelete({ resource: resource !== null, resourcesLoading, close });
  // Only when nothing is stacked on top. The deployment overlay answers
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
        tab={location.tab}
        onTabChange={onTabChange}
        focus={{ deploymentId: location.deployment, logSource: location.logSource, set: go }}
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

