/**
 * Detail panel for a real (provisioned) database resource. Header carries
 * the brand icon + name + runtime status; the body renders five tabs
 * (Deployments / Metrics / Variables / Terminal / Settings) backed by
 * the per-tab panel modules. Terminal stays mounted via Activity so its
 * PTY + scrollback survive tab switches.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { Activity } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PanelCrumb } from "@/features/resources/components/_shared/panel-breadcrumb";

import { DbConnectionsChip } from "@/features/databases/connections-popover";
import { MetricsTab } from "@/features/resources/components/_shared/metrics/metrics-tab";
import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { ResourceTerminal } from "@/features/resources/components/_shared/resource-terminal";
import { TabsContent } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { PostgresBodyProps } from "./types";

import { PANEL_TAB_BODY_CLASS, resolvePanelTab } from "../_shared/panel-tab";
import { PanelTabsChrome } from "../_shared/panel-tabs-layout";
import { PANE_MEASURE_CLASS } from "../_shared/panel-width";
import { DatabaseDataTab, DatabasePanelHeader } from "./panel-parts";
import { PostgresSettingsBody } from "./tabs/settings";
import { PostgresVariablesTabBody } from "./tabs/variables";

type ResourceTab = "deployments" | "data" | "metrics" | "variables" | "terminal" | "settings";

interface RealResourcePanelProps {
  resource: PostgresBodyProps["resource"];
  projectName: string;
  orgSlug: string;
  projectSlug: ProjectSlug;
  onClose: () => void;
  // Pending-create mode: the database is staged in the manifest but not
  // provisioned. Runtime tabs (deployments/data/metrics/terminal) + Restart
  // are disabled; Variables + Settings edit the manifest entry; opens on
  // Variables. Mirrors ServiceResourcePanel's `pending`.
  pending?: boolean;
  /** Manifest key for the staged database: the edit target in pending mode. */
  dbName?: string;
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

const DATABASE_TABS: readonly ResourceTab[] = [
  "deployments",
  "data",
  "metrics",
  "variables",
  "terminal",
  "settings",
];

// Tabs that mean anything for a staged-create ghost: nothing is provisioned
// yet, so deployments/data/metrics/terminal are disabled below and a URL
// naming one of them must not select it.
const DATABASE_PENDING_TABS: readonly ResourceTab[] = ["variables", "settings"];

export function RealResourcePanel({
  crumb,
  resource,
  orgSlug,
  projectSlug,
  onClose,
  pending = false,
  dbName,
  tab: tabParam,
  onTabChange,
}: RealResourcePanelProps) {
  const tab = resolvePanelTab(
    tabParam,
    pending ? DATABASE_PENDING_TABS : DATABASE_TABS,
    pending ? "variables" : "deployments",
  );

  // Re-roll the running container with its current spec: same image, env,
  // and public flag. Distinct from the wizard's create; this just bounces the
  // swarm task (and re-applies container labels, so a DB created before a
  // label change starts reporting metrics).
  const restartMut = useMutation({
    ...orpc.project.resource.database.postgres.restart.mutationOptions(),
    onSuccess: () => {
      toast.success("Restarting database", {
        description: "Track progress in the Deployments tab.",
      });
      onTabChange("deployments");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DatabasePanelHeader
        resource={resource}
        pending={pending}
        crumb={crumb}
        onClose={onClose}
        onRestart={() =>
          restartMut.mutate({
            projectId: resource.projectId,
            resourceId: resource.resourceId,
          })
        }
        restarting={restartMut.isPending}
        metaTrailing={
          !pending && resource.engine === "postgres" ? (
            <DbConnectionsChip resourceId={resource.resourceId} />
          ) : undefined
        }
      />

      <PanelTabsChrome
        value={tab}
        onValueChange={onTabChange}
        tabs={[
          // Runtime tabs are disabled until the database is deployed: no
          // tasks, data, metrics, or container exist yet.
          { value: "deployments", label: "Deployments", disabled: pending },
          { value: "data", label: "Data", disabled: pending },
          { value: "metrics", label: "Metrics", disabled: pending },
          { value: "variables", label: "Variables" },
          { value: "terminal", label: "Terminal", disabled: pending },
          { value: "settings", label: "Settings" },
        ]}
      >
        <div className="relative min-h-0 min-w-0 flex-1">
          <div className="h-full overflow-y-auto">
            <div className={PANEL_TAB_BODY_CLASS}>
              {/* Runtime tabs query tasks/data/metrics by resourceId, which
                  doesn't exist for a staged create. Only mount once deployed. */}
              {!pending && (
                <TabsContent value="deployments" className="px-4 pt-5 sm:px-6">
                  <ResourceTasksTab
                    projectId={resource.projectId}
                    resourceId={resource.resourceId}
                    orgSlug={orgSlug}
                    projectSlug={projectSlug}
                    logoNode={{
                      kind: "database",
                      name: resource.name,
                      description: resource.engine,
                      engine: resource.engine,
                    }}
                  />
                </TabsContent>
              )}

              {/* keepMounted: panels stay in the DOM (hidden) across tab
                  switches, so the Data studio's open table / SQL buffer and
                  half-edited forms don't reset. Deployments/Metrics stay
                  unmount-on-leave: they're pollers; unmounting stops their
                  intervals while hidden. */}
              {!pending && (
                <TabsContent value="data" keepMounted className="min-h-0 px-4 pt-5 sm:px-6">
                  <DatabaseDataTab resource={resource} />
                </TabsContent>
              )}

              {!pending && (
                <TabsContent value="metrics" className="px-4 pt-5 sm:px-6">
                  <MetricsTab resourceId={resource.resourceId} />
                </TabsContent>
              )}

              <TabsContent
                value="variables"
                keepMounted
                className={cn("px-4 pt-5 sm:px-6", PANE_MEASURE_CLASS)}
              >
                <PostgresVariablesTabBody resource={resource} pending={pending} dbName={dbName} />
              </TabsContent>

              {/* Forms cap at a reading measure; the width is for the Data
                  browser and the terminal, not for stretching a label away
                  from its input. */}
              <TabsContent
                value="settings"
                keepMounted
                className={cn("px-4 pt-5 sm:px-6", PANE_MEASURE_CLASS)}
              >
                <PostgresSettingsBody
                  resource={resource}
                  onDeleted={onClose}
                  pending={pending}
                  dbName={dbName}
                />
              </TabsContent>
            </div>
          </div>

          {/* Terminal lives OUTSIDE the height-animated <div className="relative"> (which
              sizes to its content) so it can absolutely fill this region
              instead of collapsing. keepMounted via Activity keeps the PTY +
              scrollback alive across tab switches. */}
          {!pending && (
            <Activity mode={tab === "terminal" ? "visible" : "hidden"}>
              <div className="absolute inset-0 flex flex-col p-px">
                <ResourceTerminal
                  match={{
                    kind: "database",
                    engine: resource.engine,
                    serviceName: resource.runtime.serviceName,
                  }}
                  fallbackLabel={resource.runtime.serviceName}
                  projectSlug={projectSlug}
                />
              </div>
            </Activity>
          )}
        </div>
      </PanelTabsChrome>
    </div>
  );
}
