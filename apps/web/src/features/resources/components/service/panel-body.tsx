/**
 * Tab content body for {@link ServiceResourcePanel} — pulled into a sibling
 * module so that component stays under the line/complexity caps. Purely
 * presentational; all state (active tab, logs-visited latch, live service
 * view) is owned by the panel and passed in.
 */
import type { ProjectId, ProjectSlug, ResourceId } from "@otterdeploy/shared/id";

import { Activity } from "react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";

import { MetricsTab } from "@/features/resources/components/_shared/metrics/metrics-tab";
import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { ResourceTerminal } from "@/features/resources/components/_shared/resource-terminal";
import { TabsContent } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

import type { LiveServiceView } from "./use-live-service";

import { ServiceLogsTab } from "./tabs/logs";
import { ServiceOverviewTab } from "./tabs/overview";
import { ServiceSettingsBody } from "./tabs/settings";
import { ServiceVariablesTabBody } from "./tabs/variables";

type ServiceTab =
  | "overview"
  | "deployments"
  | "metrics"
  | "logs"
  | "variables"
  | "terminal"
  | "settings";

export interface ServicePanelResource {
  resourceId: ResourceId;
  projectId: ProjectId;
  name: string;
  image: string;
  source: "image" | "git" | "upload";
  replicas: number;
  status: string;
  publicEnabled: boolean;
  publicDomain: string | null;
  extraEnv: Record<string, string>;
  secretKeys: string[];
  buildConfig?: unknown;
}

export function ServicePanelBody({
  resource,
  framework,
  orgSlug,
  projectSlug,
  onClose,
  pending,
  service,
  tab,
  onGoTab,
  logsVisited,
}: {
  resource: ServicePanelResource;
  framework?: FrameworkKind | null;
  orgSlug: string;
  projectSlug: ProjectSlug;
  onClose: () => void;
  pending: boolean;
  service: LiveServiceView | undefined;
  tab: ServiceTab;
  onGoTab: (t: ServiceTab) => void;
  logsVisited: boolean;
}) {
  return (
    <div className="relative min-h-0 flex-1">
      <div className="h-full overflow-y-auto">
        {/* Plain container, not the animated <TabsContents> — panels snap to
            their content instead of the height-spring "drop-in" on every
            tab switch. */}
        <div className="relative">
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
                orgSlug={orgSlug}
                projectSlug={projectSlug}
                onGoTab={onGoTab}
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
                logoNode={{
                  kind: "service",
                  name: resource.name,
                  description: resource.image,
                  framework,
                }}
                statusHeader={{
                  publicEnabled: resource.publicEnabled,
                  publicDomain: resource.publicDomain,
                  replicas: resource.replicas,
                  running: service?.runtime?.status === "running",
                }}
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
        </div>
      </div>

      {/* Logs + Terminal fill this region absolutely. Both stay mounted
          across tab switches — Logs via CSS `hidden` (display:none keeps its
          effects running, so its SSE stream + buffered lines survive and it
          never re-flashes "connecting"); Terminal via Activity (its PTY +
          scrollback survive). Logs mounts on first visit (`logsVisited`) so
          a panel opened only for Overview never spins up a stream. Neither
          mounts for a staged create. */}
      {!pending && logsVisited && (
        <div
          className={cn(
            "absolute inset-0 flex flex-col bg-card px-6 pt-5 pb-6",
            tab !== "logs" && "hidden",
          )}
        >
          <ServiceLogsTab projectId={resource.projectId} resourceId={resource.resourceId} />
        </div>
      )}
      {!pending && (
        <Activity mode={tab === "terminal" ? "visible" : "hidden"}>
          <div className="absolute inset-0 flex flex-col p-px">
            <ResourceTerminal
              match={{ kind: "service", resourceId: resource.resourceId }}
              fallbackLabel={resource.name}
              projectSlug={projectSlug}
            />
          </div>
        </Activity>
      )}
    </div>
  );
}
