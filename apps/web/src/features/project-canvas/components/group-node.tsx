import { type NodeProps } from "@xyflow/react";
import { LayersIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GroupNode as GroupNodeType } from "../types";

export function GroupNode({ data, selected }: NodeProps<GroupNodeType>) {
  return (
    <div
      data-canvas-node="group"
      className={cn(
        "h-full w-full rounded-2xl border-2 border-dashed bg-muted/20 p-3",
        selected ? "border-foreground/30" : "border-border/50",
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
        <LayersIcon className="size-3" />
        <span>{data.label}</span>
      </div>
    </div>
  );
}
