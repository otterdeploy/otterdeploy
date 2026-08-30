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
import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";

import { PublicHostLink } from "@/shared/components/public-host-link";

import type { PanelTabDef } from "../_shared/panel-tabs-layout";

import { resolvePanelTab } from "../_shared/panel-tab";
import { PanelTabsChrome } from "../_shared/panel-tabs-layout";
import { StackMemberStrip } from "../_shared/stack-member-strip";
import { useStackMembers } from "../_shared/use-stack-members";
import { ServicePanelBody } from "./panel-body";
import { ServicePanelHeader } from "./panel-parts";
import { replicaSummary } from "./service-status";
import { useLiveService, usePauseControl } from "./use-live-service";
import { useServiceRuntimeActions } from "./use-service-runtime-actions";
import { useServiceState } from "./use-service-state";

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
    /** The stack this service belongs to, when it is a compose member. Drives
     *  the member strip (siblings, one click away). */
    stackId?: string | null;
  };
  /** For the strip's switcher ("Go to… in <project>"). */
  projectName: string;
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
  /** Deployment focus + log source, also from the URL. */
  focus: PanelFocus;
}

// ONE order for every kind: overview · deployments · logs · variables ·
// settings, then whatever this kind appends. A stack, a service and a database
// used to each have their own order and their own names for the same tab.
const SERVICE_TABS: readonly ServiceTab[] = [
  "overview",
  "deployments",
  "logs",
  "variables",
  "settings",
  "metrics",
  "terminal",
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
    { value: "logs", label: "Logs", disabled: pending },
    { value: "variables", label: "Variables" },
    { value: "settings", label: "Settings" },
    { value: "metrics", label: "Metrics", disabled: pending },
    { value: "terminal", label: "Terminal", disabled: pending },
  ];
}

export function ServiceResourcePanel({
  crumb,
  resource,
  projectName,
  framework,
  orgSlug,
  projectSlug,
  onClose,
  pending = false,
  tab: tabParam,
  onTabChange,
  focus,
}: ServiceResourcePanelProps) {
  const tab = resolvePanelTab(
    tabParam,
    pending ? SERVICE_PENDING_TABS : SERVICE_TABS,
    pending ? "variables" : "overview",
  );
  // Latches true the first time Logs is the active tab. From then on the Logs
  // panel stays mounted (hidden when inactive) so its SSE stream survives tab
  // switches: see the Logs block below.
  //
  // Latched from the RESOLVED TAB, not from the tab-strip callback. That
  // callback only fires when the tab chrome itself is clicked, and clicking is
  // not the only way Logs opens: "View logs" on a deployment card sets
  // `?tab=logs` on the URL directly (see resource-logs-tab.tsx), as does
  // Overview's own go-to-tab. Both arrived with the tab switched and the latch
  // still false, so the block below never rendered and the pane was simply
  // blank — no source toggle, no stream, not even an empty state. Reading the
  // tab covers every route in, the click included.
  //
  // Adjusted during render (React's documented "adjust state when a prop
  // changes" pattern) rather than in an effect: the re-render happens before
  // anything commits, so there is no frame where Logs is open and empty.
  const [logsVisited, setLogsVisited] = useState(tab === "logs");
  if (tab === "logs" && !logsVisited) setLogsVisited(true);
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
  // The one state every surface in this panel reads. Runtime-derived, never
  // the schema row (see use-service-state).
  const state = useServiceState({
    projectId: resource.projectId,
    resourceId: resource.resourceId,
    service,
    pending,
  });
  const stack = useStackMembers({
    projectId: resource.projectId,
    stackResourceId: pending ? null : resource.stackId,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ServicePanelHeader
        resource={resource}
        state={state}
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

      <StackMemberStrip
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        projectId={resource.projectId}
        projectName={projectName}
        current={{ resourceId: resource.resourceId, name: resource.name, state }}
        stack={stack}
      />

      <PanelTabsChrome value={tab} onValueChange={onTabChange} tabs={serviceTabs(pending)}>
        <ServicePanelBody
          resource={resource}
          framework={framework}
          projectSlug={projectSlug}
          onClose={onClose}
          pending={pending}
          service={service}
          state={state}
          focus={focus}
          tab={tab}
          onGoTab={onTabChange}
          logsVisited={logsVisited}
        />
      </PanelTabsChrome>
    </div>
  );
}
