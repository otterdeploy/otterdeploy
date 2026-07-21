/**
 * Detail panel for a real (provisioned) database resource. Header carries
 * the brand icon + name + runtime status; the body renders five tabs
 * (Deployments / Metrics / Variables / Terminal / Settings) backed by
 * the per-tab panel modules. Terminal stays mounted via Activity so its
 * PTY + scrollback survive tab switches.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";
import { Activity, useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

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

import type { PostgresBodyProps } from "./types";

import { DatabaseDataTab, DatabasePanelHeader, DatabaseStatusBar } from "./panel-parts";
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
  /** Manifest key for the staged database — the edit target in pending mode. */
  dbName?: string;
}

export function RealResourcePanel({
  resource,
  orgSlug,
  projectSlug,
  onClose,
  pending = false,
  dbName,
}: RealResourcePanelProps) {
  const [tab, setTab] = useState<ResourceTab>(pending ? "variables" : "deployments");

  // Re-roll the running container with its current spec — same image, env,
  // and public flag. Distinct from the wizard's create; this just bounces the
  // swarm task (and re-applies container labels, so a DB created before a
  // label change starts reporting metrics).
  const restartMut = useMutation({
    ...orpc.project.resource.database.postgres.restart.mutationOptions(),
    onSuccess: () => {
      toast.success("Restarting database", {
        description: "Track progress in the Deployments tab.",
      });
      setTab("deployments");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DatabasePanelHeader
        resource={resource}
        pending={pending}
        onClose={onClose}
        onRestart={() =>
          restartMut.mutate({
            projectId: resource.projectId,
            resourceId: resource.resourceId,
          })
        }
        restarting={restartMut.isPending}
      />

      <DatabaseStatusBar
        pending={pending}
        runtime={resource.runtime}
        latestDeploymentStatus={resource.latestDeploymentStatus}
      />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (v) setTab(v as ResourceTab);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/60 px-6">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            {/* Runtime tabs are disabled until the database is deployed —
                no tasks, data, metrics, or container exist yet. */}
            <TabsTrigger value="deployments" className="px-2.5 py-2.5" disabled={pending}>
              Deployments
            </TabsTrigger>
            <TabsTrigger value="data" className="px-2.5 py-2.5" disabled={pending}>
              Data
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
              {/* Runtime tabs query tasks/data/metrics by resourceId, which
                  doesn't exist for a staged create — only mount once deployed. */}
              {!pending && (
                <TabsContent value="deployments" className="px-6 pt-5 pb-6">
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
                <TabsContent value="data" keepMounted className="min-h-0 px-6 pt-5 pb-6">
                  <DatabaseDataTab resource={resource} />
                </TabsContent>
              )}

              {!pending && (
                <TabsContent value="metrics" className="px-6 pt-5 pb-6">
                  <MetricsTab resourceId={resource.resourceId} />
                </TabsContent>
              )}

              <TabsContent value="variables" keepMounted className="px-6 pt-5 pb-6">
                <PostgresVariablesTabBody resource={resource} pending={pending} dbName={dbName} />
              </TabsContent>

              <TabsContent value="settings" keepMounted className="px-6 pt-5 pb-8">
                <PostgresSettingsBody
                  resource={resource}
                  onDeleted={onClose}
                  pending={pending}
                  dbName={dbName}
                />
              </TabsContent>
            </TabsContents>
          </div>

          {/* Terminal lives OUTSIDE the height-animated <TabsContents> (which
              sizes to its content) so it can absolutely fill this region
              instead of collapsing. keepMounted via Activity keeps the PTY +
              scrollback alive across tab switches. */}
          {!pending && (
            <Activity mode={tab === "terminal" ? "visible" : "hidden"}>
              <div className="absolute inset-0 flex flex-col p-px">
                <ResourceTerminal
                  match={{
                    kind: "database",
                    engine: resource.engine as "postgres" | "redis" | "mariadb" | "mongodb",
                    serviceName: resource.runtime.serviceName,
                  }}
                  fallbackLabel={resource.runtime.serviceName}
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
