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
import { toast } from "sonner";

import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { orpc } from "@/shared/server/orpc";

import type { ComposeService } from "./panel-parts";

import { PANEL_TAB_BODY_CLASS, resolvePanelTab } from "../_shared/panel-tab";
import { ComposePanelHeader, ComposeStatusBar } from "./panel-parts";
import { ComposeFileTab, ComposeServicesTab, ComposeSettingsTab } from "./panel-tabs";
import { StackVariablesTab } from "./stack-variables-tab";
import { useComposeServiceStatus } from "./use-compose-service-status";

type ComposeTab = "deployments" | "services" | "file" | "settings" | "variables";

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

export function ComposeResourcePanel({
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ComposePanelHeader
        name={resource.name}
        serviceCount={resource.services.length}
        source={resource.source}
        logoBrand={resource.logoBrand}
        onClose={onClose}
        onRedeploy={() =>
          redeploy.mutate({
            projectId: resource.projectId,
            resourceId: resource.resourceId,
          })
        }
        redeploying={pending || redeploy.isPending}
      />

      <ComposeStatusBar
        services={resource.services}
        serviceStatus={serviceStatus}
        stackName={resource.stackName}
      />

      <Tabs
        value={tab}
        onValueChange={(v: ComposeTab) => {
          if (v) onTabChange(v);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/60 px-4 sm:px-6">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="deployments" className="px-2.5 py-2.5" disabled={pending}>
              Deployments
            </TabsTrigger>
            <TabsTrigger value="services" className="px-2.5 py-2.5">
              Services
            </TabsTrigger>
            <TabsTrigger value="variables" className="px-2.5 py-2.5" disabled={pending}>
              Variables
            </TabsTrigger>
            <TabsTrigger value="file" className="px-2.5 py-2.5" disabled={pending}>
              Compose
            </TabsTrigger>
            <TabsTrigger value="settings" className="px-2.5 py-2.5" disabled={pending}>
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-y-auto">
            <div className={PANEL_TAB_BODY_CLASS}>
              <TabsContent value="deployments" className="px-4 pt-5 sm:px-6">
                <ResourceTasksTab
                  projectId={resource.projectId}
                  resourceId={resource.resourceId}
                  orgSlug={orgSlug}
                  projectSlug={projectSlug}
                />
              </TabsContent>

              <TabsContent value="services" className="px-4 pt-5 sm:px-6">
                <ComposeServicesTab
                  services={resource.services}
                  source={resource.source}
                  serviceStatus={serviceStatus}
                />
              </TabsContent>

              <TabsContent value="variables" className="px-4 pt-5 sm:px-6">
                <StackVariablesTab
                  projectId={resource.projectId}
                  stackResourceId={resource.resourceId}
                />
              </TabsContent>

              <TabsContent value="file" className="px-4 pt-5 sm:px-6">
                <ComposeFileTab
                  projectId={resource.projectId}
                  resourceId={resource.resourceId}
                  source={resource.source}
                  isLoading={fileQuery.isLoading}
                  composeContent={fileQuery.data?.composeContent}
                />
              </TabsContent>

              <TabsContent value="settings" className="px-4 pt-5 sm:px-6">
                <ComposeSettingsTab
                  projectId={resource.projectId}
                  resourceId={resource.resourceId}
                  orgSlug={orgSlug}
                  projectSlug={projectSlug}
                  name={resource.name}
                  serviceCount={resource.services.length}
                  onDelete={() =>
                    remove.mutate({
                      projectId: resource.projectId,
                      resourceId: resource.resourceId,
                    })
                  }
                  deleting={remove.isPending}
                />
              </TabsContent>
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
