/**
 * Detail panel for a `type: compose` stack. A stack is N services deployed as
 * one unit, so the panel answers the questions a single node can't:
 *   - Overview    → which member is up/down and why, the latest stack deploy.
 *   - Deployments → is it building / did the build fail / where are the logs.
 *   - Logs        → every member's output in one tail.
 *   - Compose     → the exact file being deployed (editable for inline stacks).
 *   - Settings    → delete it.
 *
 * A stack and its members are ONE panel: the member strip under the header
 * moves between them with a `replace` navigation that keeps the tab, so the
 * stack never has to be found again on the canvas to get back to it.
 *
 * Build progress reuses the same ResourceTasksTab as services/databases.
 * Compose deployments are stored under the compose resourceId, so the
 * deployment cards + per-deployment build logs work unchanged.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { ID_PREFIX, hasPrefix } from "@otterdeploy/shared/id";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import type { PanelCrumb } from "@/features/resources/components/_shared/panel-breadcrumb";
import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";
import type { ResourceState } from "@/features/resources/lib/resource-state";

import { clearDeleting, markDeleting } from "@/features/projects/components/graph/deleting-store";
import { invalidateManifestConsumers } from "@/features/projects/hooks/use-manifest-stage";
import { orpc } from "@/shared/server/orpc";

import type { StackMember } from "../_shared/use-stack-members";
import type { ComposeService } from "./panel-parts";

import { resolvePanelTab } from "../_shared/panel-tab";
import { StackMemberStrip } from "../_shared/stack-member-strip";
import { useStackMembers } from "../_shared/use-stack-members";
import { ComposePanelHeader } from "./panel-parts";
import { ComposePanelTabs } from "./panel-tabs-body";
import { useComposeDraft } from "./use-compose-draft";

type ComposeTab = "overview" | "deployments" | "logs" | "variables" | "settings" | "compose";

interface ComposeResourcePanelProps {
  resource: {
    resourceId: string;
    projectId: string;
    name: string;
    status: string;
    latestDeploymentStatus:
      | "pending"
      | "building"
      | "starting"
      | "running"
      | "crashed"
      | "paused"
      | "failed"
      | "cancelled"
      | "superseded"
      | "removed"
      | null;
    source: "inline" | "git";
    stackName: string;
    services: ComposeService[];
    /** Template brand mark (e.g. "Authentik") so the header shows the stack's
     *  logo instead of the generic container icon. */
    logoBrand?: string | null;
    /** Draft only: the staged compose YAML, so Overview/Compose/Variables can
     *  show what is about to deploy instead of an empty panel. */
    composeContent?: string | null;
    /** Draft only: staged stack variables, editable before the first deploy. */
    stageEnv?: Record<string, string>;
  };
  /** For the strip's switcher ("Go to… in <project>"). */
  projectName: string;
  orgSlug: string;
  projectSlug: ProjectSlug;
  onClose: () => void;
  /** Staged create, no resource row exists yet (resourceId is the empty
   *  sentinel). Disables tabs/actions that need a real resourceId and skips
   *  the resource-scoped fetches, mirroring the service/database draft
   *  panels' `pending` mode. */
  pending?: boolean;
  /** The active tab, straight off the route's `?tab=` search param. The URL
   *  owns this, not the panel. Unrecognized/absent values fall back to the
   *  usual pending-aware default. */
  tab?: string;
  /** Report a tab click so the route can write it to the URL. */
  onTabChange: (tab: string) => void;
  /** Deployment focus + log source, also from the URL. */
  focus: PanelFocus;
  /** Where this resource sits, built once by the panel dispatcher so every
   *  kind renders the same crumb. */
  crumb: PanelCrumb;
}

// ONE order for every kind: overview · deployments · logs · variables ·
// settings, then what a stack appends (its file).
const COMPOSE_TABS: readonly ComposeTab[] = [
  "overview",
  "deployments",
  "logs",
  "variables",
  "settings",
  "compose",
];

// What a staged-create ghost can show: the parsed members, the variables it
// needs before its first deploy, and the file. Deployments/Logs/Settings need a
// resource row, so a URL naming one of them must not select it.
const COMPOSE_PENDING_TABS: readonly ComposeTab[] = ["overview", "variables", "compose"];

const DRAFT_STATE: ResourceState = {
  tone: "pending",
  label: "pending",
  why: "deploys with the next apply",
};

/** The members of a stack that has never deployed: what the file declares,
 *  each one pending. */
function draftMembers(services: ComposeService[]): StackMember[] {
  return services.map((s) => ({
    name: s.name,
    serviceName: s.serviceName,
    resourceId: null,
    hasBuild: s.hasBuild,
    image: s.image,
    state: DRAFT_STATE,
  }));
}

export function ComposeResourcePanel({
  crumb,
  resource,
  projectName,
  orgSlug,
  projectSlug,
  onClose,
  pending = false,
  tab: tabParam,
  onTabChange,
  focus,
}: ComposeResourcePanelProps) {
  const tab = resolvePanelTab(tabParam, pending ? COMPOSE_PENDING_TABS : COMPOSE_TABS, "overview");
  const navigate = useNavigate();

  // The stack and its members, with each member's state, from the SAME
  // collections the graph node reads (see use-stack-members). Null while
  // staged: nothing has a row yet.
  const stack = useStackMembers({
    projectId: resource.projectId,
    stackResourceId: pending ? null : resource.resourceId,
  });
  const state: ResourceState | null = pending ? DRAFT_STATE : (stack?.state ?? null);

  // Open a member. `replace`: the drawer is already open, and one history
  // entry per open is the rule. The tab is kept (Logs → Logs).
  const openMember = (resourceId: string) => {
    void navigate({
      to: "/$orgSlug/$projectSlug/graph/$resourceId",
      params: { orgSlug, projectSlug, resourceId },
      search: (prev) => ({ tab: prev.tab }),
      replace: true,
    });
  };

  // The raw compose file (inline source) for the read-only viewer. Skipped
  // while pending: there's no resourceId yet to fetch it by.
  const fileQuery = useQuery(
    orpc.compose.get.queryOptions({
      input: {
        projectId: resource.projectId,
        resourceId: resource.resourceId,
      },
      enabled: !pending,
    }),
  );

  const draftContent = resource.composeContent ?? null;
  const { services, apply: applyStaged } = useComposeDraft({
    pending,
    projectId: resource.projectId,
    name: resource.name,
    composeContent: draftContent,
    liveServices: resource.services,
  });
  const members: StackMember[] = pending ? draftMembers(services) : (stack?.members ?? []);

  const redeploy = useMutation({
    ...orpc.compose.redeploy.mutationOptions(),
    onSuccess: () => {
      toast.success("Redeploying stack", {
        description: "Track progress in the Deployments tab.",
      });
      onTabChange("deployments");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to redeploy"),
  });

  // The panel closes the moment the operator confirms, and the graph node
  // carries the teardown from there (marked `deleting`, gone when the resource
  // is). Waiting here for every container to come down held the operator in
  // front of a spinner for a decision they had already made.
  const nodeKey = `compose:${resource.name}`;
  const remove = useMutation({
    ...orpc.compose.delete.mutationOptions(),
    onSuccess: () => {
      toast.success(`Deleted ${resource.name}`);
      // Drop the row now rather than waiting out the graph's poll: the node's
      // `deleting` mark ends when the resource leaves the collection. (The id
      // arrives here as a bare string from the panel's structural prop, so it
      // is narrowed, not asserted.)
      if (hasPrefix(resource.projectId, ID_PREFIX.project)) {
        void invalidateManifestConsumers(resource.projectId);
      }
    },
    onError: (err) => {
      // Nothing was torn down, so the node must stop looking doomed.
      clearDeleting(resource.projectId, nodeKey);
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    },
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ComposePanelHeader
        name={resource.name}
        serviceCount={services.length}
        source={resource.source}
        logoBrand={resource.logoBrand}
        onClose={onClose}
        onRedeploy={() =>
          pending
            ? applyStaged.mutate()
            : redeploy.mutate({
                projectId: resource.projectId,
                resourceId: resource.resourceId,
              })
        }
        draft={pending}
        redeploying={pending ? applyStaged.isPending : redeploy.isPending}
        crumb={crumb}
        state={state}
      />

      <StackMemberStrip
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        projectId={resource.projectId}
        projectName={projectName}
        current={{ resourceId: resource.resourceId, name: resource.name, state }}
        stack={stack}
      />

      <ComposePanelTabs
        tab={tab}
        onTabChange={onTabChange}
        pending={pending}
        resource={resource}
        services={services}
        members={members}
        state={state}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        focus={focus}
        onOpenMember={openMember}
        draftContent={draftContent}
        fileLoading={fileQuery.isLoading}
        fileContent={fileQuery.data?.composeContent}
        onDelete={() => {
          markDeleting(resource.projectId, [nodeKey]);
          onClose();
          remove.mutate({
            projectId: resource.projectId,
            resourceId: resource.resourceId,
          });
        }}
        deleting={remove.isPending}
      />
    </div>
  );
}
