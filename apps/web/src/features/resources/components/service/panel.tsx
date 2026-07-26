/**
 * Detail panel for a service resource. Header carries the name + image
 * + pause/restart/deploy actions; the body renders the tab set (Overview /
 * Deployments / Metrics / Logs / Variables / Terminal / Settings) backed by
 * the per-tab panel modules. Terminal stays mounted via Activity so its PTY +
 * scrollback survive tab switches — same pattern as RealResourcePanel for
 * databases.
 */

import type { ProjectId, ProjectSlug, ResourceId } from "@otterdeploy/shared/id";

import { useState } from "react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";

import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

import { resolvePanelTab } from "../_shared/panel-tab";

import { ServicePanelBody } from "./panel-body";
import { ServicePanelHeader, ServiceStatusBar } from "./panel-parts";
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
    // Stored build config (railpack/dockerfile/…). Optional + `unknown` to
    // match the resource-list contract; the Settings tab's build card narrows it.
    buildConfig?: unknown;
  };
  /** Detected framework for git-sourced services — drives the header tile's
   *  brand mark so the drawer matches the graph node. Null when undetected
   *  or for image-sourced services. */
  framework?: FrameworkKind | null;
  orgSlug: string;
  projectSlug: ProjectSlug;
  onClose: () => void;
  // Pending-create mode: the service isn't deployed yet. Runtime tabs +
  // header actions (restart / build) are disabled, edits target the manifest,
  // and the panel opens on Variables (the first thing to set up pre-deploy).
  pending?: boolean;
  /** The active tab, straight off the route's `?tab=` search param — the URL
   *  owns this, not the panel. Unrecognized/absent values fall back to the
   *  usual pending-aware default. */
  tab?: string;
  /** Report a tab click so the route can write it to the URL. */
  onTabChange: (tab: string) => void;
}

const SERVICE_TABS: readonly ServiceTab[] = [
  "overview",
  "deployments",
  "metrics",
  "logs",
  "variables",
  "terminal",
  "settings",
];

// Tabs that mean anything for a staged-create ghost: no container, tasks,
// metrics or logs exist yet, so the runtime tabs are disabled (see
// ServicePanelTabsList) and a URL naming one of them must not select it.
const SERVICE_PENDING_TABS: readonly ServiceTab[] = ["variables", "settings"];

/** The panel's tab strip. Runtime tabs are disabled until the service is
 *  deployed — there are no tasks, metrics, logs, or container to attach to
 *  yet. */
function ServicePanelTabsList({ pending }: { pending: boolean }) {
  return (
    <div className="border-b border-border/60 px-4 sm:px-6">
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
  tab: tabParam,
  onTabChange,
}: ServiceResourcePanelProps) {
  const tab = resolvePanelTab(
    tabParam,
    pending ? SERVICE_PENDING_TABS : SERVICE_TABS,
    pending ? "variables" : "overview",
  );
  // Latches true the first time Logs is the active tab. From then on the Logs
  // panel stays mounted (hidden when inactive) so its SSE stream survives tab
  // switches — see the Logs block below. Seeded from the resolved tab so a
  // reload or shared link landing straight on `?tab=logs` mounts it too, with
  // no click to latch on.
  const [logsVisited, setLogsVisited] = useState(tab === "logs");
  const { buildMut, restartMut } = useServiceRuntimeActions({
    resourceId: resource.resourceId,
    orgSlug,
    projectSlug,
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
            projectId: resource.projectId,
            resourceId: resource.resourceId,
          })
        }
        restarting={restartMut.isPending}
        onBuild={() =>
          buildMut.mutate({
            projectId: resource.projectId,
            resourceId: resource.resourceId,
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
          if (!v) return;
          if (v === "logs") setLogsVisited(true);
          onTabChange(v);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <ServicePanelTabsList pending={pending} />

        <ServicePanelBody
          resource={resource}
          framework={framework}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          onClose={onClose}
          pending={pending}
          service={service}
          tab={tab}
          onGoTab={onTabChange}
          logsVisited={logsVisited}
        />
      </Tabs>
    </div>
  );
}
