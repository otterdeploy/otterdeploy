/**
 * Route shell for /graph/$resourceId. Resolves the resource from the
 * live resource collection (or falls back to the design-time canvas
 * sample in INITIAL_NODES_BY_ID), then dispatches to the right detail
 * panel — real database / real service / demo node / not-found.
 *
 * AnimatePresence drives the deployment overlay's enter/exit when the
 * `/deployment/$deploymentId` child route mounts. The outer motion.div
 * is keyed by resourceId so navigating between resources slides the
 * whole panel rather than mutating in place.
 */

import {
  createFileRoute,
  Outlet,
  useChildMatches,
  useLoaderData,
} from "@tanstack/react-router";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import * as m from "motion/react-client";
import { AnimatePresence } from "motion/react";

import { INITIAL_NODES_BY_ID } from "@/features/projects/components/graph/initial-nodes";
import { resourceCollection } from "@/features/resources/data/resource";

import {
  DemoNodePanel,
  NotFound,
  RealResourcePanel,
  ServiceResourcePanel,
} from "@/features/resources/components";

export const Route = createFileRoute(
  "/_app/$orgSlug/$projectSlug/graph/$resourceId",
)({
  staticData: { crumb: "Resource" },
  component: RouteComponent,
});

function RouteComponent() {
  const { orgSlug, projectSlug, resourceId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const navigate = Route.useNavigate();
  // Key the inner Outlet by the active child match so AnimatePresence
  // sees the deployment overlay come and go. Without this the same
  // <Outlet /> element renders for every navigation and the exit never
  // fires.
  const childMatches = useChildMatches();
  const deploymentKey = childMatches[0]?.pathname ?? null;

  const { data: matches = [] } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, project.id), eq(r.resourceId, resourceId)),
        ),
    [project.id, resourceId],
  );

  const resource = matches[0] ?? null;
  // Fall back to the static graph node when nothing's in the DB yet.
  const demoNode = !resource ? (INITIAL_NODES_BY_ID[resourceId] ?? null) : null;

  // Framework brand mark for the drawer header tile — same value the graph
  // node uses, read straight off the stored resource record (detected at build
  // time). No git-API call when the panel opens.
  const serviceFramework =
    resource && resource.type === "service"
      ? (resource.framework ?? null)
      : null;

  const close = () => navigate({ to: "/$orgSlug/$projectSlug/graph" });

  return (
    <m.div
      key={resourceId}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="pointer-events-auto relative h-full w-3/5 bg-card rounded-2xl rounded-tr-none border border-r-0 border-border"
    >
      {resource && resource.type === "database" ? (
        <RealResourcePanel
          resource={resource}
          projectName={project.name}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          onClose={close}
        />
      ) : resource && resource.type === "service" ? (
        <ServiceResourcePanel
          resource={resource}
          framework={serviceFramework}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          onClose={close}
        />
      ) : demoNode ? (
        <DemoNodePanel
          node={demoNode.data}
          onClose={close}
          projectSlug={projectSlug}
        />
      ) : (
        <NotFound id={resourceId} onClose={close} />
      )}

      <AnimatePresence mode="wait">
        {deploymentKey ? <Outlet key={deploymentKey} /> : null}
      </AnimatePresence>
    </m.div>
  );
}
