/**
 * Detail panel for a service resource. Header carries the name + image
 * + draft/runtime status; the body renders four tabs (Deployments /
 * Variables / Terminal / Settings) backed by the per-tab panel modules.
 * Terminal stays mounted via Activity so its PTY + scrollback survive
 * tab switches — same pattern as RealResourcePanel for databases.
 */

import { Activity, useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";

import { MetricsTab } from "@/features/resources/components/_shared/metrics/metrics-tab";
import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { ResourceTerminal } from "@/features/resources/components/_shared/resource-terminal";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { orpc } from "@/shared/server/orpc";

import { ServicePanelHeader, ServiceStatusBar } from "./panel-parts";
import { ServiceSettingsBody } from "./tabs/settings";
import { ServiceVariablesTabBody } from "./tabs/variables";

type ServiceTab = "deployments" | "metrics" | "variables" | "terminal" | "settings";

interface ServiceResourcePanelProps {
  resource: {
    resourceId: string;
    projectId: string;
    name: string;
    image: string;
    source: "image" | "git";
    replicas: number;
    status: string;
    publicEnabled: boolean;
    publicDomain: string | null;
    extraEnv: Record<string, string>;
    secretKeys: string[];
    // Stored build config (railpack/dockerfile/…). Optional + `unknown` to
    // match the resource-list contract; the Settings tab's build card narrows it.
    buildConfig?: unknown;
  };
  /** Detected framework for git-sourced services — drives the header tile's
   *  brand mark so the drawer matches the graph node. Null when undetected
   *  or for image-sourced services. */
  framework?: FrameworkKind | null;
  orgSlug: string;
  projectSlug: string;
  onClose: () => void;
  // Pending-create mode: the service isn't deployed yet. Runtime tabs +
  // header actions (restart / build) are disabled, edits target the manifest,
  // and the panel opens on Variables (the first thing to set up pre-deploy).
  pending?: boolean;
}

export function ServiceResourcePanel({
  resource,
  framework,
  orgSlug,
  projectSlug,
  onClose,
  pending = false,
}: ServiceResourcePanelProps) {
  const [tab, setTab] = useState<ServiceTab>(pending ? "variables" : "deployments");

  // Manual build trigger for git services. The first build fires on create
  // and on git push; this is the "build it now" path (e.g. a service whose
  // initial build never ran, or to deploy the latest commit on demand).
  const buildMut = useMutation({
    ...orpc.service.build.mutationOptions(),
    onSuccess: () => {
      toast.success("Build started", {
        description: "Track progress in the Deployments tab.",
      });
      setTab("deployments");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start build"),
  });

  // Re-roll the current deployment without a rebuild. Works for both image
  // and git services — this is "redeploy this one service" (the same image,
  // bounced through the swarm). Distinct from Build & deploy, which produces
  // a fresh image from the git HEAD.
  const restartMut = useMutation({
    ...orpc.service.restart.mutationOptions(),
    onSuccess: () => {
      toast.success("Restarting service", {
        description: "Track progress in the Deployments tab.",
      });
      setTab("deployments");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ServicePanelHeader
        resource={resource}
        framework={framework}
        pending={pending}
        onClose={onClose}
        onRestart={() =>
          restartMut.mutate({
            projectId: resource.projectId as never,
            resourceId: resource.resourceId as never,
          })
        }
        restarting={restartMut.isPending}
        onBuild={() =>
          buildMut.mutate({
            projectId: resource.projectId as never,
            resourceId: resource.resourceId as never,
          })
        }
        building={buildMut.isPending}
      />

      <ServiceStatusBar
        status={resource.status}
        replicas={resource.replicas}
        publicEnabled={resource.publicEnabled}
        publicDomain={resource.publicDomain}
      />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (v) setTab(v as ServiceTab);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/60 px-6">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            {/* Runtime tabs are disabled until the service is deployed —
                there are no tasks, metrics, or container to attach to yet. */}
            <TabsTrigger value="deployments" className="px-2.5 py-2.5" disabled={pending}>
              Deployments
            </TabsTrigger>
            <TabsTrigger value="metrics" className="px-2.5 py-2.5" disabled={pending}>
              Metrics
            </TabsTrigger>
            <TabsTrigger value="variables" className="px-2.5 py-2.5">
              Variables
            </TabsTrigger>
            <TabsTrigger value="terminal" className="px-2.5 py-2.5" disabled={pending}>
              Terminal
            </TabsTrigger>
            <TabsTrigger value="settings" className="px-2.5 py-2.5">
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-y-auto">
            <TabsContents>
              {/* Runtime tabs only mount their live components once deployed —
                  they query tasks/metrics by resourceId, which doesn't exist
                  for a staged create. */}
              {!pending && (
                <TabsContent value="deployments" className="px-6 pt-5 pb-6">
                  <ResourceTasksTab
                    projectId={resource.projectId}
                    resourceId={resource.resourceId}
                    orgSlug={orgSlug}
                    projectSlug={projectSlug}
                    canRollback
                  />
                </TabsContent>
              )}

              {!pending && (
                <TabsContent value="metrics" className="px-6 pt-5 pb-6">
                  <MetricsTab resourceId={resource.resourceId} />
                </TabsContent>
              )}

              <TabsContent value="variables" className="px-6 pt-5 pb-6">
                <ServiceVariablesTabBody
                  resource={resource}
                  pending={pending}
                  serviceName={resource.name}
                />
              </TabsContent>

              <TabsContent value="settings" className="px-6 pt-5 pb-8">
                <ServiceSettingsBody resource={resource} onDeleted={onClose} pending={pending} />
              </TabsContent>
            </TabsContents>
          </div>

          {/* Terminal lives OUTSIDE the height-animated <TabsContents> (which
              sizes to its content) so it can absolutely fill this region
              instead of collapsing. keepMounted via Activity keeps the PTY +
              scrollback alive across tab switches. Not mounted for a staged
              create — there's no container to attach a PTY to. */}
          {!pending && (
            <Activity mode={tab === "terminal" ? "visible" : "hidden"}>
              <div className="absolute inset-0 flex flex-col p-px">
                <ResourceTerminal
                  match={{
                    kind: "service",
                    resourceId: resource.resourceId,
                  }}
                  fallbackLabel={resource.name}
                  projectSlug={projectSlug}
                />
              </div>
            </Activity>
          )}
        </div>
      </Tabs>
    </div>
  );
}
