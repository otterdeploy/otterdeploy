import { type NodeProps } from "@xyflow/react";
import { ContainerIcon, GitBranchIcon, GlobeIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ServiceNode as ServiceNodeType } from "../types";

const dotByStatus: Record<ServiceNodeType["data"]["status"], string> = {
  running: "bg-emerald-500",
  starting: "bg-amber-500",
  stopped: "bg-zinc-500",
  missing: "bg-zinc-500",
  error: "bg-rose-500",
};

export function ServiceNode({ data, selected }: NodeProps<ServiceNodeType>) {
  const SourceIcon = data.source.type === "github" ? GitBranchIcon : ContainerIcon;
  const sourceLabel =
    data.source.type === "github" ? `${data.source.repo}@${data.source.branch}` : data.source.image;
  return (
    <div
      data-canvas-node="service"
      className={cn(
        "flex w-52 flex-col gap-1.5 rounded-xl border bg-card px-3 py-3 shadow-sm",
        selected ? "border-foreground/30 ring-2 ring-foreground/10" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <SourceIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{data.name}</span>
        <span className={cn("ml-auto size-1.5 rounded-full", dotByStatus[data.status])} />
      </div>
      <div className="truncate text-[10px] text-muted-foreground">{sourceLabel}</div>
      {data.publicHostname ? (
        <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground/80">
          <GlobeIcon className="size-2.5 shrink-0" />
          <span className="truncate">{data.publicHostname}</span>
        </div>
      ) : null}
    </div>
  );
}
