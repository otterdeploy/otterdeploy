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

import { useMemo } from "react";
import {
  createFileRoute,
  Outlet,
  useChildMatches,
  useLoaderData,
} from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";

import * as m from "motion/react-client";
import { AnimatePresence } from "motion/react";

import { INITIAL_NODES_BY_ID } from "@/features/projects/components/graph/initial-nodes";
import { createResourceCollection } from "@/features/projects/data/resource";

import {
  DemoNodePanel,
  NotFound,
  RealResourcePanel,
  ServiceResourcePanel,
} from "@/features/projects/components/resource-panels";

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

  const resourceCollection = useMemo(
    () => createResourceCollection(project.id),
    [project.id],
  );

  const { data: matches = [] } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) => eq(r.resourceId, resourceId)),
    [resourceId, resourceCollection],
  );

  const resource = matches[0] ?? null;
  // Fall back to the static graph node when nothing's in the DB yet.
  const demoNode = !resource ? (INITIAL_NODES_BY_ID[resourceId] ?? null) : null;

  const close = () => navigate({ to: "/$orgSlug/$projectSlug/graph" });

  return (
    <m.div
      key={resourceId}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="pointer-events-auto relative h-full w-3/5 bg-muted rounded-2xl rounded-tr-none border border-r-0 border-border"
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
