import { type NodeProps } from "@xyflow/react";
import { HardDriveIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import type { VolumeNode as VolumeNodeType } from "../types";

export function VolumeNode({ data, selected }: NodeProps<VolumeNodeType>) {
  return (
    <div
      data-canvas-node="volume"
      className={cn(
        "flex w-44 items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 shadow-sm",
        selected ? "border-foreground/30 ring-2 ring-foreground/10" : "border-border",
      )}
    >
      <HardDriveIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate text-[10px] text-muted-foreground">{data.source}</span>
    </div>
  );
}
