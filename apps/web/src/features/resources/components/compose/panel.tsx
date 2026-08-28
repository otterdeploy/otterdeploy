/**
 * Detail panel for a `type: compose` stack. A stack is N services deployed as
 * one unit, so the panel answers the three questions a single node can't:
 *   - Deployments → is it building / did the build fail / where are the logs.
 *   - Services    → how many services, what's in each, which one is up/down.
 *   - Compose     → the exact file being deployed (editable for inline stacks).
 *   - Settings    → redeploy the whole stack / delete it.
 *
 * Build progress reuses the same ResourceTasksTab as services/databases.
 * Compose deployments are stored under the compose resourceId, so the
 * deployment cards + per-deployment build logs work unchanged.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import type { ProjectResource } from "@/features/projects/components/graph/resource-to-node";
import type { PanelCrumb } from "@/features/resources/components/_shared/panel-breadcrumb";
import type { PanelRailChild } from "@/features/resources/components/_shared/panel-tabs-layout";

import { orpc } from "@/shared/server/orpc";

import type { ComposeService, StackServiceStatus } from "./panel-parts";

import { resolvePanelTab } from "../_shared/panel-tab";
import { ComposePanelHeader } from "./panel-parts";
import { ComposePanelTabs } from "./panel-tabs-body";
import { useComposeDraft } from "./use-compose-draft";
import { useComposeServiceStatus } from "./use-compose-service-status";

type ComposeTab = "deployments" | "services" | "file" | "settings" | "variables";

/** One row of `project.resource.list`: the same union the graph reads. */
type ProjectResourceRow = ProjectResource;

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
    /** Draft only: the staged compose YAML, so Services/Compose/Variables can
     *  show what is about to deploy instead of an empty panel. */
    composeContent?: string | null;
    /** Draft only: staged stack variables, editable before the first deploy. */
    stageEnv?: Record<string, string>;
  };
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
  /** Where this resource sits, built once by the panel dispatcher so every
   *  kind renders the same crumb. */
  crumb: PanelCrumb;
}

const COMPOSE_TABS: readonly ComposeTab[] = [
  "deployments",
  "services",
  "variables",
  "file",
  "settings",
];

// The only tab that means anything for a staged-create ghost: the stack isn't
// parsed or deployed yet, so deployments/file/settings are disabled below and a
// URL naming one of them must not select it.
const COMPOSE_PENDING_TABS: readonly ComposeTab[] = ["services"];

/**
 * The header pill's `2/2 running`, rolled up from the children.
 *
 * A staged stack has no children running yet, so it reports null and gets no
 * pill at all — `0/2` on something that was never deployed reads as an outage.
 */
function rollUpChildren(
  services: { serviceName: string }[],
  serviceStatus: (serviceName: string) => StackServiceStatus,
  pending: boolean,
): { up: number; total: number; anyError: boolean } | null {
  if (pending) return null;
  return {
    up: services.filter((s) => serviceStatus(s.serviceName) === "running").length,
    total: services.length,
    anyError: services.some((s) => serviceStatus(s.serviceName) === "error"),
  };
}

/** Rail dot per child state, in the graph's own vocabulary. `pending` and
 *  `offline` get no colour: neither has earned one. */
const RAIL_DOT: Partial<Record<StackServiceStatus, string>> = {
  running: "bg-success",
  building: "bg-warning",
  deploying: "bg-info",
  error: "bg-destructive",
};

/**
 * The stack's children as rail entries.
 *
 * Each member is a real service resource, so opening one is the same
 * navigation the canvas does (compose-group-node) rather than local state. The
 * join key is `serviceName`: a child's `name` is collision-suffixed, so it
 * would match the wrong row for a second copy of the same stack. A member with
 * no materialized resource yet (a staged stack) is left out rather than
 * rendered as a dead entry.
 */
function buildRailChildren(input: {
  services: ComposeService[];
  siblings: ProjectResourceRow[] | undefined;
  stackResourceId: string;
  serviceStatus: (serviceName: string) => StackServiceStatus;
  open: (resourceId: string) => void;
}): PanelRailChild[] {
  const childIds = new Map(
    (input.siblings ?? []).flatMap((row) =>
      row.type === "service" && row.stackId === input.stackResourceId
        ? [[row.serviceName, row.resourceId]]
        : [],
    ),
  );
  return input.services.flatMap((service) => {
    const child = childIds.get(service.serviceName);
    if (!child) return [];
    return [
      {
        id: service.name,
        label: service.name,
        dotClass: RAIL_DOT[input.serviceStatus(service.serviceName)],
        onOpen: () => {
          input.open(child);
        },
      },
    ];
  });
}

export function ComposeResourcePanel({
  crumb,
  resource,
  orgSlug,
  projectSlug,
  onClose,
  pending = false,
  tab: tabParam,
  onTabChange,
}: ComposeResourcePanelProps) {
  const tab = resolvePanelTab(
    tabParam,
    pending ? COMPOSE_PENDING_TABS : COMPOSE_TABS,
    pending ? "services" : "deployments",
  );

  // Per-service status: see use-compose-service-status.ts. Reads the EXACT
  // same source the graph node does, so the node and this panel can never
  // disagree about what's running.
  const serviceStatus = useComposeServiceStatus(resource);
  const navigate = useNavigate();
  // Already warmed by the graph page; this is a cache read, not a request.
  const siblings = useQuery(
    orpc.project.resource.list.queryOptions({ input: { projectId: resource.projectId } }),
  );

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

  const remove = useMutation({
    ...orpc.compose.delete.mutationOptions(),
    onSuccess: () => {
      toast.success(`Deleted ${resource.name}`);
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete"),
  });

  const railChildren = buildRailChildren({
    services: resource.services,
    siblings: siblings.data,
    stackResourceId: resource.resourceId,
    serviceStatus,
    open: (resourceId) => {
      void navigate({
        to: "/$orgSlug/$projectSlug/graph/$resourceId",
        params: { orgSlug, projectSlug, resourceId },
      });
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
        running={rollUpChildren(services, serviceStatus, pending)}
      />

      <ComposePanelTabs
        tab={tab}
        onTabChange={onTabChange}
        pending={pending}
        resource={resource}
        services={services}
        serviceStatus={serviceStatus}
        railChildren={railChildren}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        draftContent={draftContent}
        fileLoading={fileQuery.isLoading}
        fileContent={fileQuery.data?.composeContent}
        onDelete={() =>
          remove.mutate({
            projectId: resource.projectId,
            resourceId: resource.resourceId,
          })
        }
        deleting={remove.isPending}
      />
    </div>
  );
}
