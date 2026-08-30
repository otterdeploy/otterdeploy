/**
 * Resolves which detail panel to render for /graph/$resourceId. Real
 * resource, staged-create draft (service/database/compose), loading
 * skeleton, or not-found. Extracted out of the route's RouteComponent so
 * that stays under the line/complexity caps. The draft builders live in
 * ./resource-drafts for the same reason.
 */
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { useQuery } from "@tanstack/react-query";

import type { PanelCrumb } from "@/features/resources/components/_shared/panel-breadcrumb";
import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";

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
  /** Deployment focus + log source from the URL. See _shared/panel-tab.ts. */
  focus: PanelFocus;
}

/**
 * Where the open resource sits, built once here because this is the only place
 * that knows all three parts: the project, the resource, and (for a compose
 * child) the stack above it. Every panel kind renders the same crumb from it,
 * so "where am I" can't answer differently per resource type.
 */
function buildCrumb(input: {
  project: { id: ProjectId; name: string };
  orgSlug: string;
  projectSlug: ProjectSlug;
  resourceId?: string;
  /** A compose child's parent stack; null for everything else. */
  stackId?: string | null;
}): PanelCrumb {
  return {
    orgSlug: input.orgSlug,
    projectSlug: input.projectSlug,
    projectId: input.project.id,
    projectName: input.project.name,
    parentResourceId: input.stackId ?? null,
    ...(input.resourceId ? { currentResourceId: input.resourceId } : {}),
  };
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
  focus,
  onClose,
}: PanelChromeProps & { resource: LiveResource }) {
  if (resource.type === "database") {
    return (
      <RealResourcePanel
        resource={resource}
        crumb={buildCrumb({ project, orgSlug, projectSlug, resourceId: resource.resourceId })}
        projectName={project.name}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
        focus={focus}
      />
    );
  }
  if (resource.type === "service") {
    return (
      <ServiceResourcePanel
        resource={resource}
        // A stack member carries `stackId`, which is what puts the stack in
        // its crumb. Until this, a service opened from inside a stack said
        // nothing about the stack it belonged to.
        crumb={buildCrumb({
          project,
          orgSlug,
          projectSlug,
          resourceId: resource.resourceId,
          stackId: resource.stackId,
        })}
        // Framework brand mark for the drawer header tile: same value the
        // graph node uses, read straight off the stored resource record
        // (detected at build time). No git-API call when the panel opens.
        framework={resource.framework ?? null}
        projectName={project.name}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
        focus={focus}
      />
    );
  }
  return (
    <ComposeResourcePanel
      resource={resource}
      crumb={buildCrumb({ project, orgSlug, projectSlug, resourceId: resource.resourceId })}
      projectName={project.name}
      orgSlug={orgSlug}
      projectSlug={projectSlug}
      onClose={onClose}
      tab={tab}
      onTabChange={onTabChange}
      focus={focus}
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
  focus,
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
        crumb={buildCrumb({ project, orgSlug, projectSlug })}
        framework={null}
        projectName={project.name}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
        focus={focus}
        pending
      />
    );
  }
  const draftDatabase = draftDatabaseFromManifest(manifest.data, resourceId, pendingName, project.id);
  if (draftDatabase) {
    return (
      <RealResourcePanel
        resource={draftDatabase}
        crumb={buildCrumb({ project, orgSlug, projectSlug })}
        projectName={project.name}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
        focus={focus}
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
        crumb={buildCrumb({ project, orgSlug, projectSlug })}
        projectName={project.name}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onClose={onClose}
        tab={tab}
        onTabChange={onTabChange}
        focus={focus}
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
  focus,
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
  focus: PanelFocus;
  onClose: () => void;
}) {
  const chrome = { project, orgSlug, projectSlug, onClose, tab, onTabChange, focus };
  if (resource) {
    return <AppliedResourcePanel resource={resource} {...chrome} />;
  }
  if (resourcesLoading) return <ResourcePanelSkeleton onClose={onClose} />;
  return <DraftResourcePanel resourceId={resourceId} {...chrome} />;
}
