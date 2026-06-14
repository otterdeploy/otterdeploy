/**
 * Detail panel for a real (provisioned) database resource. Header carries
 * the brand icon + name + runtime status; the body renders five tabs
 * (Deployments / Metrics / Variables / Terminal / Settings) backed by
 * the per-tab panel modules. Terminal stays mounted via Activity so its
 * PTY + scrollback survive tab switches.
 */

import { Activity, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";

import type { ResourceEngine } from "@/features/projects/components/graph/resource-node";
import { orpc } from "@/shared/server/orpc";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { Button } from "@/shared/components/ui/button";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import { MetricsTab } from "@/features/resources/components/_shared/metrics/metrics-tab";
import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { ResourceTerminal } from "@/features/resources/components/_shared/resource-terminal";
import type { PostgresBodyProps } from "./types";

import { UnsupportedDataViewer } from "@/features/resources/components/_shared/data/unsupported-data-viewer";
import { RedisDataTabBody } from "@/features/resources/components/redis/tabs/data";
import { DataTabBody } from "./tabs/data";
import { PostgresSettingsBody } from "./tabs/settings";
import { PostgresVariablesTabBody } from "./tabs/variables";

type ResourceTab =
  | "deployments"
  | "data"
  | "metrics"
  | "variables"
  | "terminal"
  | "settings";

interface RealResourcePanelProps {
  resource: PostgresBodyProps["resource"];
  projectName: string;
  orgSlug: string;
  projectSlug: string;
  onClose: () => void;
}

export function RealResourcePanel({
  resource,
  orgSlug,
  projectSlug,
  onClose,
}: RealResourcePanelProps) {
  const [tab, setTab] = useState<ResourceTab>("deployments");

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
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to graph"
            onClick={onClose}
            className="mt-1"
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
          <PanelIcon
            node={{
              kind: "database",
              name: resource.name,
              description: "",
              engine: resource.engine as ResourceEngine,
            }}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-bold leading-none tracking-tight">
              {resource.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {resource.engine}{" "}
              <span className="text-muted-foreground/50">·</span>{" "}
              {resource.databaseName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              restartMut.mutate({
                projectId: resource.projectId as never,
                resourceId: resource.resourceId as never,
              })
            }
            disabled={restartMut.isPending}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            {restartMut.isPending ? "Restarting…" : "Restart"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            onClick={onClose}
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
        <RuntimeStatusBadge status={resource.runtime.status} />
        <span className="text-[13px] text-muted-foreground">
          {resource.runtime.health ?? "Provisioned"}
        </span>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (v) setTab(v as ResourceTab);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/60 px-6">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="deployments" className="px-2.5 py-2.5">
              Deployments
            </TabsTrigger>
            <TabsTrigger value="data" className="px-2.5 py-2.5">
              Data
            </TabsTrigger>
            <TabsTrigger value="metrics" className="px-2.5 py-2.5">
              Metrics
            </TabsTrigger>
            <TabsTrigger value="variables" className="px-2.5 py-2.5">
              Variables
            </TabsTrigger>
            <TabsTrigger value="terminal" className="px-2.5 py-2.5">
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
              <TabsContent value="deployments" className="px-6 pt-5 pb-6">
                <ResourceTasksTab
                  projectId={resource.projectId}
                  resourceId={resource.resourceId}
                  orgSlug={orgSlug}
                  projectSlug={projectSlug}
                />
              </TabsContent>

              {/* Each engine gets its native browser; unsupported engines say so
                  plainly rather than falling back to the SQL console. */}
              <TabsContent value="data" className="min-h-0 px-6 pt-5 pb-6">
                {resource.engine === "postgres" ? (
                  <DataTabBody resource={resource} />
                ) : resource.engine === "redis" ? (
                  <RedisDataTabBody resource={resource} />
                ) : (
                  <UnsupportedDataViewer engine={resource.engine} />
                )}
              </TabsContent>

              <TabsContent value="metrics" className="px-6 pt-5 pb-6">
                <MetricsTab resourceId={resource.resourceId} />
              </TabsContent>

              <TabsContent value="variables" className="px-6 pt-5 pb-6">
                <PostgresVariablesTabBody resource={resource} />
              </TabsContent>

              <TabsContent value="settings" className="px-6 pt-5 pb-8">
                <PostgresSettingsBody resource={resource} onDeleted={onClose} />
              </TabsContent>
            </TabsContents>
          </div>

          {/* Terminal lives OUTSIDE the height-animated <TabsContents> (which
              sizes to its content) so it can absolutely fill this region
              instead of collapsing. keepMounted via Activity keeps the PTY +
              scrollback alive across tab switches. */}
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
        </div>
      </Tabs>
    </div>
  );
}

function RuntimeStatusBadge({ status }: { status: string }) {
  const tone =
    status === "running"
      ? "bg-success/12 text-success"
      : status === "starting"
        ? "bg-warning/12 text-warning"
        : status === "error"
          ? "bg-destructive/12 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] ${tone}`}
    >
      {status.toUpperCase()}
    </span>
  );
}
