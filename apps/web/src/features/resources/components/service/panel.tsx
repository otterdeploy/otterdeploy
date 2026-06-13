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
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  RefreshIcon,
  RocketIcon,
} from "@hugeicons/core-free-icons";

import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { Button } from "@/shared/components/ui/button";
import type { FrameworkKind } from "@/features/projects/components/framework-logo";
import { orpc } from "@/shared/server/orpc";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { ResourceTerminal } from "@/features/resources/components/_shared/resource-terminal";

import { ServiceSettingsBody } from "./tabs/settings";
import { ServiceVariablesTabBody } from "./tabs/variables";

type ServiceTab = "deployments" | "variables" | "terminal" | "settings";

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
}

export function ServiceResourcePanel({
  resource,
  framework,
  orgSlug,
  projectSlug,
  onClose,
}: ServiceResourcePanelProps) {
  const [tab, setTab] = useState<ServiceTab>("deployments");

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
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to start build"),
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
              kind: "service",
              name: resource.name,
              description: resource.image,
              framework,
            }}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-bold leading-none tracking-tight">
              {resource.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {resource.image}
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
          {resource.source === "git" ? (
            <Button
              type="button"
              size="sm"
              onClick={() =>
                buildMut.mutate({
                  projectId: resource.projectId as never,
                  resourceId: resource.resourceId as never,
                })
              }
              disabled={buildMut.isPending}
            >
              <HugeiconsIcon
                icon={RocketIcon}
                strokeWidth={2}
                className="size-3.5"
              />
              {buildMut.isPending ? "Starting…" : "Build & deploy"}
            </Button>
          ) : null}
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
        <StatusBadge status={resource.status} />
        <span className="text-[13px] text-muted-foreground">
          {resource.replicas} desired replica{resource.replicas === 1 ? "" : "s"}
          {resource.publicEnabled && resource.publicDomain
            ? ` · public on ${resource.publicDomain}`
            : ""}
        </span>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (v) setTab(v as ServiceTab);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/60 px-6">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="deployments" className="px-2.5 py-2.5">
              Deployments
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContents>
            <TabsContent value="deployments" className="px-6 pt-5 pb-6">
              <ResourceTasksTab
                projectId={resource.projectId}
                resourceId={resource.resourceId}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
              />
            </TabsContent>

            <TabsContent value="variables" className="px-6 pt-5 pb-6">
              <ServiceVariablesTabBody resource={resource} />
            </TabsContent>

            {/* keepMounted + Activity keeps the terminal session, PTY,
                and xterm scrollback alive across tab switches. */}
            <TabsContent
              value="terminal"
              keepMounted
              className="px-6 pt-5 pb-6"
            >
              <Activity mode={tab === "terminal" ? "visible" : "hidden"}>
                <ResourceTerminal
                  match={{
                    kind: "service",
                    resourceId: resource.resourceId,
                  }}
                  fallbackLabel={resource.name}
                  projectSlug={projectSlug}
                />
              </Activity>
            </TabsContent>

            <TabsContent value="settings" className="px-6 pt-5 pb-8">
              <ServiceSettingsBody resource={resource} onDeleted={onClose} />
            </TabsContent>
          </TabsContents>
        </div>
      </Tabs>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "valid"
      ? "bg-success/12 text-success"
      : status === "draft"
        ? "bg-warning/12 text-warning"
        : status === "invalid"
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
