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

import { ResourcePanelSkeleton } from "@/features/resources/components/_shared/panel-skeleton";
import { resourceCollection } from "@/features/resources/data/resource";
import { orpc } from "@/shared/server/orpc";

import {
  ComposeResourcePanel,
  NotFound,
  type PostgresBodyProps,
  RealResourcePanel,
  ServiceResourcePanel,
} from "@/features/resources/components";

export const Route = createFileRoute(
  "/_app/$orgSlug/$projectSlug/graph/$resourceId",
)({
  staticData: { crumb: "Resource" },
  component: RouteComponent,
});

type ManifestData = Awaited<ReturnType<typeof orpc.project.manifest.get.call>>;

// Synthetic "draft" service from the manifest entry — enough to render the
// panel; resourceId is empty because no resource row exists yet (pending mode
// never calls resource-scoped APIs). Returns null unless `resourceId` is a
// staged `service:<name>` ghost whose spec is present in the manifest.
function draftServiceFromManifest(
  manifestData: ManifestData | undefined,
  resourceId: string,
  pendingName: string,
  projectId: string,
) {
  if (!resourceId.startsWith("service:")) return null;
  const spec = manifestData?.manifest?.services?.[pendingName];
  if (!spec) return null;
  return {
    resourceId: "",
    projectId,
    name: pendingName,
    image: spec.source === "image" ? spec.image : "Pending build",
    source: spec.source,
    replicas: spec.replicas ?? 1,
    status: "draft",
    publicEnabled: false,
    publicDomain: null,
    extraEnv: spec.env ?? {},
    secretKeys: [],
    buildConfig: spec.source === "git" ? spec.build : undefined,
  };
}

// Staged database create → the REAL database panel in pending mode. Only the
// fields the pending tab bodies read are real; runtime/credential fields are
// unused while pending, so the draft is cast to the full resource view.
function draftDatabaseFromManifest(
  manifestData: ManifestData | undefined,
  resourceId: string,
  pendingName: string,
  projectId: string,
): PostgresBodyProps["resource"] | null {
  if (!resourceId.startsWith("database:")) return null;
  const spec = manifestData?.manifest?.databases?.[pendingName];
  if (!spec) return null;
  return {
    resourceId: "",
    projectId,
    name: pendingName,
    type: "database",
    status: "draft",
    engine: spec.engine,
    publicEnabled: spec.publicEnabled ?? false,
    extraEnv: spec.extraEnv ?? {},
    secretKeys: [],
    extensions: spec.engine === "postgres" ? (spec.extensions ?? []) : [],
  } as unknown as PostgresBodyProps["resource"];
}

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

  // No applied resource → this is a staged-create ghost. Read its full spec
  // from the manifest (cached) so the panel can edit it. Both staged services
  // and staged databases render their *real* panels in pending mode (editable
  // env / extensions / settings via the manifest, runtime tabs disabled).
  const manifest = useQuery(
    orpc.project.manifest.get.queryOptions({ input: { id: project.id } }),
  );
  const pendingName = resourceId.includes(":")
    ? resourceId.slice(resourceId.indexOf(":") + 1)
    : resourceId;

  // Both staged services and staged databases render their *real* panels in
  // pending mode (editable env / extensions / settings via the manifest,
  // runtime tabs disabled). An applied resource short-circuits to null — the
  // draft only exists for a staged-create ghost.
  const draftService = resource
    ? null
    : draftServiceFromManifest(
        manifest.data,
        resourceId,
        pendingName,
        project.id,
      );
  const draftDatabase = resource
    ? null
    : draftDatabaseFromManifest(
        manifest.data,
        resourceId,
        pendingName,
        project.id,
      );

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
    if (resource && resource.type === "compose") {
      return (
        <ComposeResourcePanel
          resource={resource}
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
    if (draftDatabase) {
      return (
        <RealResourcePanel
          resource={draftDatabase}
          projectName={project.name}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          onClose={close}
          pending
          dbName={pendingName}
        />
      );
    }
    // Manifest still loading for a staged ghost — show a skeleton so the drawer
    // never slides in blank (rather than flashing "not found").
    if (!resource && manifest.isLoading) return <ResourcePanelSkeleton />;
    return <NotFound id={resourceId} onClose={close} />;
  };

  return (
    <m.div
      key={resourceId}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="pointer-events-auto relative h-full w-full bg-card rounded-lg rounded-tr-none border border-r-0 border-border lg:w-4/5 xl:w-3/5"
    >
      {panel()}

      <AnimatePresence mode="wait">
        {deploymentKey ? <Outlet key={deploymentKey} /> : null}
      </AnimatePresence>
    </m.div>
  );
}
