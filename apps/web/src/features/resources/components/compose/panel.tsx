/**
 * Detail panel for a `type: compose` stack. A stack is N services deployed as
 * one unit, so the panel answers the three questions a single node can't:
 *   - Deployments → is it building / did the build fail / where are the logs.
 *   - Services    → how many services, what's in each, which one is up/down.
 *   - Compose     → the exact file being deployed (read-only).
 *   - Settings    → redeploy the whole stack / delete it.
 *
 * Build progress reuses the same ResourceTasksTab as services/databases —
 * compose deployments are stored under the compose resourceId, so the
 * deployment cards + per-deployment build logs work unchanged.
 */

import { useState } from "react";

import { eq, useLiveQuery } from "@tanstack/react-db";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { orpc } from "@/shared/server/orpc";

import type { ComposeService, StackServiceStatus } from "./panel-parts";

import { baseStatus, ComposePanelHeader, ComposeStatusBar, rollupTaskStatus } from "./panel-parts";
import { ComposeFileTab, ComposeServicesTab, ComposeSettingsTab } from "./panel-tabs";

type ComposeTab = "deployments" | "services" | "file" | "settings";

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
      | "failed"
      | "superseded"
      | "removed"
      | null;
    source: "inline" | "git";
    stackName: string;
    services: ComposeService[];
  };
  orgSlug: string;
  projectSlug: string;
  onClose: () => void;
}

export function ComposeResourcePanel({
  resource,
  orgSlug,
  projectSlug,
  onClose,
}: ComposeResourcePanelProps) {
  const [tab, setTab] = useState<ComposeTab>("deployments");

  // Live per-service status from swarm tasks (the same feed the graph group
  // uses). Each task carries its compose sub-service key, so we roll up per
  // service — "which one is down?" is answerable here too.
  const { data: taskRows } = useLiveQuery(
    (q) =>
      q.from({ d: serviceTasksCollection }).where(({ d }) => eq(d.projectId, resource.projectId)),
    [resource.projectId],
  );
  const byService = rollupTaskStatus(taskRows, resource.resourceId);
  const base = baseStatus(resource.latestDeploymentStatus);
  const serviceStatus = (name: string): StackServiceStatus =>
    byService.get(name) ?? base ?? "offline";

  // The raw compose file (inline source) for the read-only viewer.
  const fileQuery = useQuery(
    orpc.compose.get.queryOptions({
      input: {
        projectId: resource.projectId,
        resourceId: resource.resourceId,
      },
    }),
  );

  const redeploy = useMutation({
    ...orpc.compose.redeploy.mutationOptions(),
    onSuccess: () => {
      toast.success("Redeploying stack", {
        description: "Track progress in the Deployments tab.",
      });
      setTab("deployments");
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
        onClose={onClose}
        onRedeploy={() =>
          redeploy.mutate({
            projectId: resource.projectId,
            resourceId: resource.resourceId,
          })
        }
        redeploying={redeploy.isPending}
      />

      <ComposeStatusBar
        services={resource.services}
        serviceStatus={serviceStatus}
        stackName={resource.stackName}
      />

      <Tabs
        value={tab}
        onValueChange={(v: ComposeTab) => {
          if (v) setTab(v);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/60 px-6">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="deployments" className="px-2.5 py-2.5">
              Deployments
            </TabsTrigger>
            <TabsTrigger value="services" className="px-2.5 py-2.5">
              Services
            </TabsTrigger>
            <TabsTrigger value="file" className="px-2.5 py-2.5">
              Compose
            </TabsTrigger>
            <TabsTrigger value="settings" className="px-2.5 py-2.5">
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-y-auto">
            <TabsContents>
              <TabsContent value="deployments" className="px-6 pt-5 pb-6">
                <ResourceTasksTab
                  projectId={resource.projectId}
                  resourceId={resource.resourceId}
                  orgSlug={orgSlug}
                  projectSlug={projectSlug}
                />
              </TabsContent>

              <TabsContent value="services" className="px-6 pt-5 pb-6">
                <ComposeServicesTab
                  services={resource.services}
                  source={resource.source}
                  serviceStatus={serviceStatus}
                />
              </TabsContent>

              <TabsContent value="file" className="px-6 pt-5 pb-6">
                <ComposeFileTab
                  source={resource.source}
                  isLoading={fileQuery.isLoading}
                  composeContent={fileQuery.data?.composeContent}
                />
              </TabsContent>

              <TabsContent value="settings" className="px-6 pt-5 pb-8">
                <ComposeSettingsTab
                  projectId={resource.projectId}
                  resourceId={resource.resourceId}
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
            </TabsContents>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
