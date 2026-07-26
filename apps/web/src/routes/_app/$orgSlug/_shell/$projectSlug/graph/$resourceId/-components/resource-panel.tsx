/**
 * Resolves which detail panel to render for /graph/$resourceId — real
 * resource, staged-create draft (service/database/compose), loading
 * skeleton, or not-found. Extracted out of the route's RouteComponent so
 * that stays under the line/complexity caps.
 */
import type { ProjectId, ProjectSlug, ResourceId } from "@otterdeploy/shared/id";

import { useQuery } from "@tanstack/react-query";

import { ResourcePanelSkeleton } from "@/features/resources/components/_shared/panel-skeleton";
import { orpc } from "@/shared/server/orpc";

import {
  ComposeResourcePanel,
  NotFound,
  type PostgresBodyProps,
  RealResourcePanel,
  ServiceResourcePanel,
} from "@/features/resources/components";

type ManifestData = Awaited<ReturnType<typeof orpc.project.manifest.get.call>>;
type LiveResource = Awaited<ReturnType<typeof orpc.project.resource.list.call>>[number];

// Synthetic "draft" service from the manifest entry — enough to render the
// panel; resourceId is empty because no resource row exists yet (pending mode
// never calls resource-scoped APIs). Returns null unless `resourceId` is a
// staged `service:<name>` ghost whose spec is present in the manifest.
function draftServiceFromManifest(
  manifestData: ManifestData | undefined,
  resourceId: string,
  pendingName: string,
  projectId: ProjectId,
) {
  if (!resourceId.startsWith("service:")) return null;
  const spec = manifestData?.manifest?.services?.[pendingName];
  if (!spec) return null;
  return {
    // Pending draft: no resource row exists yet, so there's no ResourceId.
    // The empty sentinel is safe — pending mode never calls resource-scoped
    // APIs (see the panel's `pending` short-circuits).
    resourceId: "" as ResourceId,
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

// Staged compose (stack) create → the real compose panel in pending mode.
// The manifest's compose entry carries the file source/content, not a
// per-service breakdown (that's parsed from the file at deploy time), so the
// draft renders with an empty service list — same "honest, not fabricated"
// posture as the other drafts. Mirrors draftServiceFromManifest /
// draftDatabaseFromManifest so a compose ghost node (id `compose:<name>`,
// no resourceId yet) opens a panel instead of falling through to NotFound.
function draftComposeFromManifest(
  manifestData: ManifestData | undefined,
  resourceId: string,
  pendingName: string,
  projectId: ProjectId,
) {
  if (!resourceId.startsWith("compose:")) return null;
  const spec = manifestData?.manifest?.composes?.[pendingName];
  if (!spec) return null;
  return {
    resourceId: "",
    projectId,
    name: pendingName,
    status: "draft",
    latestDeploymentStatus: "pending" as const,
    source: spec.source,
    stackName: pendingName,
    services: [],
    logoBrand: spec.logoBrand ?? null,
  };
}

interface PanelChromeProps {
  project: { id: ProjectId; name: string };
  orgSlug: string;
  projectSlug: ProjectSlug;
  onClose: () => void;
  /** Active tab from the route's `?tab=` search param, and the writer that
   *  puts a clicked tab back into the URL. Every panel kind is controlled by
   *  the URL rather than owning tab state — see _shared/panel-tab.ts. */
  tab?: string;
  onTabChange: (tab: string) => void;
}

/** An applied (real, already-provisioned) resource — dispatches to its own
 *  kind's panel. Split out of ResourcePanel so each dispatcher stays under
 *  the complexity cap. */
function AppliedResourcePanel({
  resource,
  project,
  orgSlug,
  projectSlug,
  tab,
  onTabChange,
  onClose,
}: PanelChromeProps & { resource: LiveResource }) {
  if (resource.type === "database") {
    return (
      <RealResourcePanel
        resource={resource}
        projectName={project.name}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
      />
    );
  }
  if (resource.type === "service") {
    return (
      <ServiceResourcePanel
        resource={resource}
        // Framework brand mark for the drawer header tile — same value the
        // graph node uses, read straight off the stored resource record
        // (detected at build time). No git-API call when the panel opens.
        framework={resource.framework ?? null}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
      />
    );
  }
  return (
    <ComposeResourcePanel
      resource={resource}
      orgSlug={orgSlug}
      projectSlug={projectSlug}
      onClose={onClose}
      tab={tab}
      onTabChange={onTabChange}
    />
  );
}

/** No applied resource → this is a staged-create ghost (or truly missing).
 *  Reads the manifest (cached) so the panel can edit the staged spec — both
 *  staged services and staged databases render their *real* panels in
 *  pending mode (editable env / extensions / settings via the manifest,
 *  runtime tabs disabled). Applied resources never mount this component, so
 *  the manifest round-trip is only ever paid for a ghost. */
function DraftResourcePanel({
  resourceId,
  project,
  orgSlug,
  projectSlug,
  tab,
  onTabChange,
  onClose,
}: PanelChromeProps & { resourceId: string }) {
  const manifest = useQuery(
    orpc.project.manifest.get.queryOptions({ input: { id: project.id } }),
  );
  const pendingName = resourceId.includes(":")
    ? resourceId.slice(resourceId.indexOf(":") + 1)
    : resourceId;

  const draftService = draftServiceFromManifest(manifest.data, resourceId, pendingName, project.id);
  if (draftService) {
    return (
      <ServiceResourcePanel
        resource={draftService}
        framework={null}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
        pending
      />
    );
  }
  const draftDatabase = draftDatabaseFromManifest(manifest.data, resourceId, pendingName, project.id);
  if (draftDatabase) {
    return (
      <RealResourcePanel
        resource={draftDatabase}
        projectName={project.name}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
        pending
        dbName={pendingName}
      />
    );
  }
  const draftCompose = draftComposeFromManifest(manifest.data, resourceId, pendingName, project.id);
  if (draftCompose) {
    return (
      <ComposeResourcePanel
        resource={draftCompose}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
        pending
      />
    );
  }
  // Manifest still loading for a staged ghost — show a skeleton so the drawer
  // never slides in blank (rather than flashing "not found").
  if (manifest.isLoading) return <ResourcePanelSkeleton onClose={onClose} />;
  return <NotFound id={resourceId} onClose={onClose} />;
}

export function ResourcePanel({
  resource,
  resourceId,
  resourcesLoading,
  project,
  orgSlug,
  projectSlug,
  tab,
  onTabChange,
  onClose,
}: {
  resource: LiveResource | null;
  resourceId: string;
  /** The resource collection hasn't finished its first load. Deep-linking or
   *  hard-reloading straight onto a panel hits this, and without it a real
   *  resource resolves to null → the draft path → a "not found" flash once the
   *  manifest (which has no ghost under this id) resolves first. */
  resourcesLoading: boolean;
  project: { id: ProjectId; name: string };
  orgSlug: string;
  projectSlug: ProjectSlug;
  /** Active tab from the route's `?tab=` search param (also how the graph node
   *  context menu's "Delete" lands straight on Settings), plus the writer that
   *  puts a clicked tab back into the URL. */
  tab?: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
}) {
  const chrome = { project, orgSlug, projectSlug, onClose, tab, onTabChange };
  if (resource) {
    return <AppliedResourcePanel resource={resource} {...chrome} />;
  }
  if (resourcesLoading) return <ResourcePanelSkeleton onClose={onClose} />;
  return <DraftResourcePanel resourceId={resourceId} {...chrome} />;
}
