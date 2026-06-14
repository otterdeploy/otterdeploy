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

import {
  createFileRoute,
  Outlet,
  useChildMatches,
  useLoaderData,
} from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";

import * as m from "motion/react-client";
import { AnimatePresence } from "motion/react";

import { resourceCollection } from "@/features/resources/data/resource";
import { orpc } from "@/shared/server/orpc";

import {
  NotFound,
  RealResourcePanel,
  ServiceResourcePanel,
  StagedResourcePanel,
  type StagedCreate,
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

  // Scope to the project and resolve in JS so a single param can match either
  // form the graph navigates with: the real `resourceId` (applied resources),
  // or `${kind}:${name}` (a staged-create ghost, and the URL that lingers
  // across the ghost→applied handover — same collection GraphCanvas loads, so
  // no extra fetch).
  const { data: resources = [] } = useLiveQuery(
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

  // No applied resource → this is a staged-create ghost. Read its full spec
  // from the manifest (cached) so the panel can edit it. A staged service
  // renders the *real* ServiceResourcePanel in pending mode (editable env +
  // domains, runtime tabs disabled); a staged database still shows the
  // read-only preview for now.
  const manifest = useQuery(
    orpc.project.manifest.get.queryOptions({ input: { id: project.id } }),
  );
  const pendingName = resourceId.includes(":")
    ? resourceId.slice(resourceId.indexOf(":") + 1)
    : resourceId;
  const svcSpec =
    !resource && resourceId.startsWith("service:")
      ? manifest.data?.manifest?.services?.[pendingName]
      : undefined;

  // Synthetic "draft" resource from the manifest entry — enough to render the
  // panel; resourceId is empty because no resource row exists yet (pending
  // mode never calls resource-scoped APIs).
  const draftService = svcSpec
    ? {
        resourceId: "",
        projectId: project.id,
        name: pendingName,
        image: svcSpec.source === "image" ? svcSpec.image : "Pending build",
        source: svcSpec.source,
        replicas: svcSpec.replicas ?? 1,
        status: "draft",
        publicEnabled: false,
        publicDomain: null,
        extraEnv: svcSpec.env ?? {},
        secretKeys: [],
        buildConfig: svcSpec.source === "git" ? svcSpec.build : undefined,
      }
    : null;

  // Staged database create → read-only preview (from the diff summary).
  const dbSpec =
    !resource && resourceId.startsWith("database:")
      ? manifest.data?.manifest?.databases?.[pendingName]
      : undefined;
  const stagedDbCreate: StagedCreate | null = dbSpec
    ? {
        kind: "create",
        resource: "database",
        name: pendingName,
        details: { engine: dbSpec.engine },
      }
    : null;

  // Framework brand mark for the drawer header tile — same value the graph
  // node uses, read straight off the stored resource record (detected at build
  // time). No git-API call when the panel opens.
  const serviceFramework =
    resource && resource.type === "service"
      ? (resource.framework ?? null)
      : null;

  const close = () => navigate({ to: "/$orgSlug/$projectSlug/graph" });

  const panel = () => {
    if (resource && resource.type === "database") {
      return (
        <RealResourcePanel
          resource={resource}
          projectName={project.name}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          onClose={close}
        />
      );
    }
    if (resource && resource.type === "service") {
      return (
        <ServiceResourcePanel
          resource={resource}
          framework={serviceFramework}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          onClose={close}
        />
      );
    }
    if (draftService) {
      return (
        <ServiceResourcePanel
          resource={draftService}
          framework={null}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          onClose={close}
          pending
        />
      );
    }
    if (stagedDbCreate) {
      return <StagedResourcePanel change={stagedDbCreate} onClose={close} />;
    }
    // Manifest still loading for a staged ghost — hold the panel blank rather
    // than flashing "not found".
    if (!resource && manifest.isLoading) return null;
    return <NotFound id={resourceId} onClose={close} />;
  };

  return (
    <m.div
      key={resourceId}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="pointer-events-auto relative h-full w-full bg-card rounded-2xl rounded-tr-none border border-r-0 border-border lg:w-4/5 xl:w-3/5"
    >
      {panel()}

      <AnimatePresence mode="wait">
        {deploymentKey ? <Outlet key={deploymentKey} /> : null}
      </AnimatePresence>
    </m.div>
  );
}
