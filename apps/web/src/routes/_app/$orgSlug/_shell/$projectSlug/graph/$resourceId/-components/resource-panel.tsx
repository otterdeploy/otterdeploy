/**
 * Resolves which detail panel to render for /graph/$resourceId. Real
 * resource, staged-create draft (service/database/compose), loading
 * skeleton, or not-found. Extracted out of the route's RouteComponent so
 * that stays under the line/complexity caps. The draft builders live in
 * ./resource-drafts for the same reason.
 */
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { useQuery } from "@tanstack/react-query";

import { ResourcePanelSkeleton } from "@/features/resources/components/_shared/panel-skeleton";
import { orpc } from "@/shared/server/orpc";

import {
  ComposeResourcePanel,
  NotFound,
  RealResourcePanel,
  ServiceResourcePanel,
} from "@/features/resources/components";

import {
  draftComposeFromManifest,
  draftDatabaseFromManifest,
  draftServiceFromManifest,
} from "./resource-drafts";

type LiveResource = Awaited<ReturnType<typeof orpc.project.resource.list.call>>[number];

interface PanelChromeProps {
  project: { id: ProjectId; name: string };
  orgSlug: string;
  projectSlug: ProjectSlug;
  onClose: () => void;
  /** Active tab from the route's `?tab=` search param, and the writer that
   *  puts a clicked tab back into the URL. Every panel kind is controlled by
   *  the URL rather than owning tab state: see _shared/panel-tab.ts. */
  tab?: string;
  onTabChange: (tab: string) => void;
}

/** An applied (real, already-provisioned) resource. Dispatches to its own
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
        // Framework brand mark for the drawer header tile: same value the
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
 *  Reads the manifest (cached) so the panel can edit the staged spec. Both
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
  // Manifest still loading for a staged ghost: show a skeleton so the drawer
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
