// Wide tabbed layout for nodes without a real backing resource yet
// (design-time / canvas mode). Real resources use RealResourcePanel; this
// renders the same five tabs but every section is placeholder data.

import { useState } from "react";

import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";
import { cn } from "@/shared/lib/utils";

import { demoMeta } from "./demo-meta";
import { DemoPanelHeader } from "./demo-header";
import { DemoTabs, type DemoTab } from "./demo-tabs";

interface DemoNodePanelProps {
  node: ResourceNodeData;
  onClose: () => void;
  projectSlug: string;
}

export function DemoNodePanel({ node, onClose, projectSlug }: DemoNodePanelProps) {
  const meta = demoMeta(node);
  const isBuilding = node.status === "building";
  const isError = node.status === "error";

  const stateLabel = isError ? "FAILED" : isBuilding ? "BUILDING" : "ONLINE";
  const stateTone = isError
    ? "bg-destructive/12 text-destructive"
    : isBuilding
      ? "bg-warning/12 text-warning"
      : "bg-success/12 text-success";
  const stateSubtitle = isError
    ? "Deployment failed · check logs"
    : isBuilding
      ? "Build in progress…"
      : `Successful deployment (${meta.deployedAt})`;

  const [tab, setTab] = useState<DemoTab>("deployments");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DemoPanelHeader node={node} repo={meta.repo} onClose={onClose} />

      <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
        <span
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em]",
            stateTone,
          )}
        >
          {stateLabel}
        </span>
        <span className="text-[13px] text-muted-foreground">{stateSubtitle}</span>
      </div>

      <DemoTabs
        node={node}
        meta={meta}
        tab={tab}
        setTab={setTab}
        projectSlug={projectSlug}
      />
    </div>
  );
}
