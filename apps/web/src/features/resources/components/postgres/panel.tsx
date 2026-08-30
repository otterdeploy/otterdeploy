/**
 * Detail panel for a real (provisioned) database resource. Header carries
 * the brand icon + name + runtime state; the body renders the tabs in the
 * order every kind shares (Overview / Deployments / Logs / Variables /
 * Settings) plus what a database appends (Data / Metrics / Terminal). Terminal stays mounted via Activity so its
 * PTY + scrollback survive tab switches.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";



import type { PanelCrumb } from "@/features/resources/components/_shared/panel-breadcrumb";
import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";

import { DbConnectionsChip } from "@/features/databases/connections-popover";
import { MetricsTab } from "@/features/resources/components/_shared/metrics/metrics-tab";
import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { databaseState } from "@/features/resources/lib/resource-state";
import { TabsContent } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

import type { PostgresBodyProps } from "./types";

import { PANEL_TAB_BODY_CLASS, resolvePanelTab } from "../_shared/panel-tab";
import { PanelTabsChrome } from "../_shared/panel-tabs-layout";
import { PANE_MEASURE_CLASS } from "../_shared/panel-width";
import { StackMemberStrip } from "../_shared/stack-member-strip";
import { DatabaseDataTab, DatabasePanelHeader } from "./panel-parts";
import {
  DatabaseSurfaces,
  databaseTabs,
  useDatabaseRestart,
  type DatabaseTab,
} from "./panel-surfaces";
import { DatabaseOverviewTab } from "./tabs/overview";
import { PostgresSettingsBody } from "./tabs/settings";
import { PostgresVariablesTabBody } from "./tabs/variables";

type ResourceTab = DatabaseTab;

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
  /** Deployment focus + log source, also from the URL. */
  focus: PanelFocus;
  /** Where this resource sits, built once by the panel dispatcher so every
   *  kind renders the same crumb. */
  crumb: PanelCrumb;
}

// ONE order for every kind: overview · deployments · logs · variables ·
// settings, then what a database appends.
const DATABASE_TABS: readonly ResourceTab[] = [
  "overview",
  "deployments",
  "logs",
  "variables",
  "settings",
  "data",
  "metrics",
  "terminal",
];

// Tabs that mean anything for a staged-create ghost: nothing is provisioned
// yet, so deployments/data/metrics/terminal are disabled below and a URL
// naming one of them must not select it.
const DATABASE_PENDING_TABS: readonly ResourceTab[] = ["variables", "settings"];

export function RealResourcePanel({
  crumb,
  resource,
  projectName,
  orgSlug,
  projectSlug,
  onClose,
  pending = false,
  dbName,
  tab: tabParam,
  onTabChange,
  focus,
}: RealResourcePanelProps) {
  const tab = resolvePanelTab(
    tabParam,
    pending ? DATABASE_PENDING_TABS : DATABASE_TABS,
    pending ? "variables" : "overview",
  );
  // The one state every surface in this panel reads. A staged create has no
  // runtime; the draft the dispatcher builds carries none, and that reads as
  // pending here without touching the deploy flag first.
  const state = databaseState({
    runtime: pending ? undefined : resource.runtime,
    latestDeploymentStatus: resource.latestDeploymentStatus,
  });

  const restartMut = useDatabaseRestart(() => onTabChange("deployments"));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DatabasePanelHeader
        resource={resource}
        state={state}
        crumb={crumb}
        onClose={onClose}
        onRestart={() =>
          restartMut.mutate({
            projectId: resource.projectId,
            resourceId: resource.resourceId,
          })
        }
        restarting={restartMut.isPending}
        // A database inside a shared server has no container of its own, so a
        // restart would roll the SERVER and every other database on it. The
        // API refuses it; hiding the button is the honest version of that
        // rather than an action that always errors.
        canRestart={!resource.hostResourceId}
        metaTrailing={
          !pending && resource.engine === "postgres" ? (
            <DbConnectionsChip resourceId={resource.resourceId} />
          ) : undefined
        }
      />

      <StackMemberStrip
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        projectId={resource.projectId}
        projectName={projectName}
        current={{ resourceId: resource.resourceId, name: resource.name, state }}
        stack={null}
      />

      <PanelTabsChrome value={tab} onValueChange={onTabChange} tabs={databaseTabs(pending)}>
        <div className="relative min-h-0 min-w-0 flex-1">
          <div className="h-full overflow-y-auto">
            <div className={PANEL_TAB_BODY_CLASS}>
              {!pending && (
                <TabsContent value="overview" className="px-4 pt-5 sm:px-6">
                  <DatabaseOverviewTab
                    resource={resource}
                    state={state}
                    focus={focus}
                    onGoTab={onTabChange}
                  />
                </TabsContent>
              )}

              {/* Runtime tabs query tasks/data/metrics by resourceId, which
                  doesn't exist for a staged create. Only mount once deployed. */}
              {!pending && (
                <TabsContent value="deployments" className="px-4 pt-5 sm:px-6">
                  <ResourceTasksTab
                    projectId={resource.projectId}
                    resourceId={resource.resourceId}
                    focus={focus}
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

          {!pending && (
            <DatabaseSurfaces
              resource={resource}
              tab={tab}
              projectSlug={projectSlug}
              focus={focus}
            />
          )}
        </div>
      </PanelTabsChrome>
    </div>
  );
}
