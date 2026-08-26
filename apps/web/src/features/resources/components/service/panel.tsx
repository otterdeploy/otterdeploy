/**
 * Detail panel for a service resource. Header carries the name + image
 * + pause/restart/deploy actions; the body renders the tab set (Overview /
 * Deployments / Metrics / Logs / Variables / Terminal / Settings) backed by
 * the per-tab panel modules. Terminal stays mounted via Activity so its PTY +
 * scrollback survive tab switches: same pattern as RealResourcePanel for
 * databases.
 */

import type { BuildConfig } from "@otterdeploy/shared/build-config";
import type { ProjectId, ProjectSlug, ResourceId } from "@otterdeploy/shared/id";

import { useState } from "react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";
import type { PanelCrumb } from "@/features/resources/components/_shared/panel-breadcrumb";

import { PublicHostLink } from "@/shared/components/public-host-link";

import type { PanelTabDef } from "../_shared/panel-tabs-layout";

import { resolvePanelTab } from "../_shared/panel-tab";
import { PanelTabsChrome } from "../_shared/panel-tabs-layout";
import { ServicePanelBody } from "./panel-body";
import { ServicePanelHeader } from "./panel-parts";
import { replicaSummary } from "./service-status";
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
    // Stored build config (railpack/dockerfile/…), as the contract's
    // discriminated union; the Settings tab's build card switches on `builder`.
    buildConfig?: BuildConfig | null;
  };
  /** Detected framework for git-sourced services: drives the header tile's
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

/** Runtime tabs are disabled until the service is deployed: there are no
 *  tasks, metrics, logs, or container to attach to yet. */
function serviceTabs(pending: boolean): PanelTabDef[] {
  return [
    { value: "overview", label: "Overview", disabled: pending },
    { value: "deployments", label: "Deployments", disabled: pending },
    { value: "metrics", label: "Metrics", disabled: pending },
    { value: "logs", label: "Logs", disabled: pending },
    { value: "variables", label: "Variables" },
    { value: "terminal", label: "Terminal", disabled: pending },
    { value: "settings", label: "Settings" },
  ];
}

export function ServiceResourcePanel({
  crumb,
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
  // switches: see the Logs block below. Seeded from the resolved tab so a
  // reload or shared link landing straight on `?tab=logs` mounts it too, with
  // no click to latch on.
  const [logsVisited, setLogsVisited] = useState(tab === "logs");
  const { buildMut, restartMut } = useServiceRuntimeActions({
    resourceId: resource.resourceId,
    orgSlug,
    projectSlug,
  });

  // Live service view (runtime status, pause marker, ports). Richer than the
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
        status={resource.status}
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
        onBuild={(noCache) =>
          buildMut.mutate({
            projectId: resource.projectId,
            resourceId: resource.resourceId,
            ...(noCache ? { noCache: true } : {}),
          })
        }
        building={buildMut.isPending}
        pause={pending ? null : pause}
        crumb={crumb}
        // Replicas and the public domain used to be a row of their own. They
        // are facts about this service's identity, so they continue the meta
        // line instead — and the domain stays the one clickable thing on it.
        replicaLine={
          pending ? null : (
            <>
              {" · "}
              {replicaSummary({
                replicas: resource.replicas,
                pausedReplicas: service?.pausedReplicas ?? null,
              })}
              {resource.publicEnabled &&
              resource.publicDomain &&
              service?.pausedReplicas == null ? (
                <>
                  {" · "}
                  <PublicHostLink host={resource.publicDomain} className="text-foreground/90" />
                </>
              ) : null}
            </>
          )
        }
      />

      <PanelTabsChrome
        value={tab}
        onValueChange={(next) => {
          if (next === "logs") setLogsVisited(true);
          onTabChange(next);
        }}
        tabs={serviceTabs(pending)}
      >
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
      </PanelTabsChrome>
    </div>
  );
}
