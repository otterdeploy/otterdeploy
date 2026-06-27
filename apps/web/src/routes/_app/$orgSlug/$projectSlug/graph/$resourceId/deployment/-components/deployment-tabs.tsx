import { Activity } from "react";

import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";

import {
  DeploymentDetailsBody,
  type DeploymentRow,
} from "./deployment-detail";
import {
  BuildLogsBody,
  DeploymentLogsBody,
  NotImplementedTab,
} from "./deployment-logs";

export type DeploymentTab =
  | "details"
  | "build-logs"
  | "deploy-logs"
  | "http-logs"
  | "network-logs";

export function DeploymentTabs({
  tab,
  onTabChange,
  deployment,
  projectId,
  resourceId,
  deploymentId,
}: {
  tab: DeploymentTab;
  onTabChange: (tab: DeploymentTab) => void;
  deployment: DeploymentRow | null;
  projectId: string;
  resourceId: string;
  deploymentId: string;
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        if (v) onTabChange(v as DeploymentTab);
      }}
      className="mt-4 flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="border-b border-border/60 px-6">
        <TabsList variant="line" className="h-auto bg-transparent p-0">
          <TabsTrigger value="details" className="px-2.5 py-2.5">
            Details
          </TabsTrigger>
          <TabsTrigger value="build-logs" className="px-2.5 py-2.5">
            Build Logs
          </TabsTrigger>
          <TabsTrigger value="deploy-logs" className="px-2.5 py-2.5">
            Deploy Logs
          </TabsTrigger>
          <TabsTrigger value="http-logs" className="px-2.5 py-2.5">
            HTTP Logs
          </TabsTrigger>
          <TabsTrigger value="network-logs" className="px-2.5 py-2.5">
            Network Flow Logs
          </TabsTrigger>
        </TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TabsContents className="h-full">
          <TabsContent
            value="details"
            keepMounted
            className="h-full overflow-y-auto px-6 pt-5 pb-6"
          >
            <Activity mode={tab === "details" ? "visible" : "hidden"}>
              <DeploymentDetailsBody
                deployment={deployment}
                projectId={projectId}
                resourceId={resourceId}
                deploymentId={deploymentId}
              />
            </Activity>
          </TabsContent>
          <TabsContent
            value="build-logs"
            keepMounted
            className="flex h-full min-h-0 flex-col px-6 pt-5 pb-6"
          >
            <Activity mode={tab === "build-logs" ? "visible" : "hidden"}>
              <BuildLogsBody deploymentId={deploymentId} />
            </Activity>
          </TabsContent>
          <TabsContent
            value="deploy-logs"
            keepMounted
            className="flex h-full min-h-0 flex-col px-6 pt-5 pb-6"
          >
            <Activity mode={tab === "deploy-logs" ? "visible" : "hidden"}>
              <DeploymentLogsBody
                projectId={projectId}
                resourceId={resourceId}
                deploymentId={deploymentId}
              />
            </Activity>
          </TabsContent>
          <TabsContent
            value="http-logs"
            keepMounted
            className="flex h-full min-h-0 flex-col px-6 pt-5 pb-6"
          >
            <Activity mode={tab === "http-logs" ? "visible" : "hidden"}>
              <NotImplementedTab
                title="HTTP request logs"
                hint="Caddy-fronted resources will stream per-request access logs here. Wiring lands once the Caddy log adapter ships."
              />
            </Activity>
          </TabsContent>
          <TabsContent
            value="network-logs"
            keepMounted
            className="flex h-full min-h-0 flex-col px-6 pt-5 pb-6"
          >
            <Activity mode={tab === "network-logs" ? "visible" : "hidden"}>
              <NotImplementedTab
                title="Network flow logs"
                hint="Per-task connection metadata (peer, bytes in/out, duration) will land here once the swarm flow collector is wired."
              />
            </Activity>
          </TabsContent>
        </TabsContents>
      </div>
    </Tabs>
  );
}
