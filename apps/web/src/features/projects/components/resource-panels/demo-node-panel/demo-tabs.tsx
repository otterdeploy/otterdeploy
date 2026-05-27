import { Activity } from "react";

import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";

import { SectionLabel } from "../atoms";
import { SettingsTabBody } from "../demo-settings";
import { MetricsTabBody, type MetricsMeta } from "../metrics-tab";
import { ResourceTerminal } from "../resource-terminal";
import { DeployRow } from "./demo-rows";
import { VariablesTabBody } from "./variables-tab";

export type DemoTab =
  | "deployments"
  | "metrics"
  | "variables"
  | "terminal"
  | "settings";

interface DemoTabsProps {
  node: ResourceNodeData;
  meta: MetricsMeta & { repo: string; domain: string | null };
  tab: DemoTab;
  setTab: (t: DemoTab) => void;
  projectSlug: string;
}

export function DemoTabs({ node, meta, tab, setTab, projectSlug }: DemoTabsProps) {
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        if (v) setTab(v as DemoTab);
      }}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="border-b border-border/60 px-6">
        <TabsList variant="line" className="h-auto bg-transparent p-0">
          <TabsTrigger value="deployments" className="px-2.5 py-2.5">
            Deployments
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TabsContents>
          <TabsContent value="deployments" className="px-6 pt-5 pb-6">
            <SectionLabel>Recent deployments</SectionLabel>
            {node.git && (
              <div className="mt-4 space-y-4 font-mono text-[12.5px]">
                <DeployRow
                  commit={node.git.commit.slice(0, 7)}
                  message={node.git.message}
                  age="11m ago"
                  author="arjun"
                />
                <DeployRow
                  commit="b7e1c9d"
                  message="chore: bump dependencies"
                  age="2h ago"
                  author="mira"
                />
                <DeployRow
                  commit="a3f8b2c"
                  message="fix: handle empty preflight headers"
                  age="1d ago"
                  author="arjun"
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="metrics" className="px-6 pt-5 pb-6">
            <MetricsTabBody meta={meta} replicaName={`${node.name}.r1`} />
          </TabsContent>

          <TabsContent value="variables" className="px-6 pt-5 pb-6">
            <VariablesTabBody
              projectName={node.name === "imgproxy" ? "paperhouse" : "gravy-truck"}
            />
          </TabsContent>

          {/* keepMounted + Activity keeps the terminal session, PTY,
              and xterm scrollback alive across tab switches. */}
          <TabsContent value="terminal" keepMounted className="px-6 pt-5 pb-6">
            <Activity mode={tab === "terminal" ? "visible" : "hidden"}>
              <ResourceTerminal
                match={{
                  kind: "service",
                  resourceId: `demo-${node.name}`,
                }}
                fallbackLabel={`otterstack-${node.name}-1`}
                projectSlug={projectSlug}
              />
            </Activity>
          </TabsContent>

          <TabsContent value="settings" className="px-6 pt-5 pb-6">
            <SettingsTabBody node={node} meta={meta} />
          </TabsContent>
        </TabsContents>
      </div>
    </Tabs>
  );
}
