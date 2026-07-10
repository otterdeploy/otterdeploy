/**
 * Detail panel for a service resource. Header carries the name + image
 * + pause/restart/deploy actions; the body renders the tab set (Overview /
 * Deployments / Metrics / Logs / Variables / Terminal / Settings) backed by
 * the per-tab panel modules. Terminal stays mounted via Activity so its PTY +
 * scrollback survive tab switches — same pattern as RealResourcePanel for
 * databases.
 */

import { Activity, useState } from "react";

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

import { ServicePanelHeader, ServiceStatusBar } from "./panel-parts";
import { ServiceLogsTab } from "./tabs/logs";
import { ServiceOverviewTab } from "./tabs/overview";
import { ServiceSettingsBody } from "./tabs/settings";
import { ServiceVariablesTabBody } from "./tabs/variables";
import { useLiveService, usePauseControl } from "./use-live-service";
import { useServiceRuntimeActions } from "./use-service-runtime-actions";

type ServiceTab =
  | "overview"
  | "deployments"
  | "metrics"
  | "logs"
  | "variables"
  | "terminal"
  | "settings";

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

/** The panel's tab strip. Runtime tabs are disabled until the service is
 *  deployed — there are no tasks, metrics, logs, or container to attach to
 *  yet. */
function ServicePanelTabsList({ pending }: { pending: boolean }) {
  return (
    <div className="border-b border-border/60 px-6">
      <TabsList variant="line" className="h-auto bg-transparent p-0">
        <TabsTrigger value="overview" className="px-2.5 py-2.5" disabled={pending}>
          Overview
        </TabsTrigger>
        <TabsTrigger value="deployments" className="px-2.5 py-2.5" disabled={pending}>
          Deployments
        </TabsTrigger>
        <TabsTrigger value="metrics" className="px-2.5 py-2.5" disabled={pending}>
          Metrics
        </TabsTrigger>
        <TabsTrigger value="logs" className="px-2.5 py-2.5" disabled={pending}>
          Logs
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
  );
}

export function ServiceResourcePanel({
  resource,
  framework,
  orgSlug,
  projectSlug,
  onClose,
  pending = false,
}: ServiceResourcePanelProps) {
  const [tab, setTab] = useState<ServiceTab>(pending ? "variables" : "overview");
  const { buildMut, restartMut } = useServiceRuntimeActions({
    projectId: resource.projectId,
    resourceId: resource.resourceId,
    orgSlug,
    projectSlug,
    onNoDeployment: () => setTab("deployments"),
  });

  // Live service view (runtime status, pause marker, ports) — richer than the
  // resource-list row the panel receives. Undefined while loading or pending.
  const service = useLiveService({
    projectId: resource.projectId,
    resourceId: resource.resourceId,
    enabled: !pending,
  });
  const pause = usePauseControl({
    projectId: resource.projectId,
    resourceId: resource.resourceId,
    service,
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
        pause={pending ? null : pause}
      />

      <ServiceStatusBar
        status={resource.status}
        replicas={resource.replicas}
        publicEnabled={resource.publicEnabled}
        publicDomain={resource.publicDomain}
        pausedReplicas={service?.pausedReplicas}
      />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (v) setTab(v as ServiceTab);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <ServicePanelTabsList pending={pending} />

        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-y-auto">
            <TabsContents>
              {/* Runtime tabs only mount their live components once deployed —
                  they query tasks/metrics by resourceId, which doesn't exist
                  for a staged create. Overview/Deployments/Metrics stay
                  unmount-on-leave — they're pollers; unmounting stops their
                  intervals while hidden. */}
              {!pending && (
                <TabsContent value="overview" className="px-6 pt-5 pb-6">
                  <ServiceOverviewTab
                    resource={resource}
                    service={service}
                    onGoTab={(t) => setTab(t)}
                  />
                </TabsContent>
              )}

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

              {/* keepMounted: panels stay in the DOM (hidden) across tab
                  switches, so half-edited env values and settings forms don't
                  reset. */}
              <TabsContent value="variables" keepMounted className="px-6 pt-5 pb-6">
                <ServiceVariablesTabBody
                  resource={resource}
                  pending={pending}
                  serviceName={resource.name}
                />
              </TabsContent>

              <TabsContent value="settings" keepMounted className="px-6 pt-5 pb-8">
                <ServiceSettingsBody resource={resource} onDeleted={onClose} pending={pending} />
              </TabsContent>
            </TabsContents>
          </div>

          {/* Logs + Terminal live OUTSIDE the height-animated <TabsContents>
              (which sizes to its content) so they can absolutely fill this
              region instead of collapsing. Logs mounts only while its tab is
              active — leaving the tab closes the SSE stream. Terminal stays
              keepMounted via Activity so its PTY + scrollback survive tab
              switches. Neither mounts for a staged create. */}
          {!pending && tab === "logs" && (
            <div className="absolute inset-0 flex flex-col bg-card px-6 pt-5 pb-6">
              <ServiceLogsTab projectId={resource.projectId} resourceId={resource.resourceId} />
            </div>
          )}
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
