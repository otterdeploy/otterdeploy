/**
 * Detail panel for a service resource. Header carries the name + image
 * + draft/runtime status; the body renders four tabs (Deployments /
 * Variables / Terminal / Settings) backed by the per-tab panel modules.
 * Terminal stays mounted via Activity so its PTY + scrollback survive
 * tab switches — same pattern as RealResourcePanel for databases.
 */

import { Activity, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";

import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { Button } from "@/shared/components/ui/button";

import { PanelIcon } from "./atoms";
import { ResourceTasksTab } from "./resource-tasks-tab";
import { ResourceTerminal } from "./resource-terminal";
import { ServiceSettingsBody } from "./service-settings";
import { ServiceVariablesTabBody } from "./service-variables";

type ServiceTab = "deployments" | "variables" | "terminal" | "settings";

interface ServiceResourcePanelProps {
  resource: {
    resourceId: string;
    projectId: string;
    name: string;
    image: string;
    replicas: number;
    status: string;
    publicEnabled: boolean;
    publicDomain: string | null;
    extraEnv: Record<string, string>;
    secretKeys: string[];
  };
  orgSlug: string;
  projectSlug: string;
  onClose: () => void;
}

export function ServiceResourcePanel({
  resource,
  orgSlug,
  projectSlug,
  onClose,
}: ServiceResourcePanelProps) {
  const [tab, setTab] = useState<ServiceTab>("deployments");

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
