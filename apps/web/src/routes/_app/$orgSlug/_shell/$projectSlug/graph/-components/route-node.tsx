/**
 * Compact pill node for a public route (one per public host). Deliberately
 * smaller than a resource card — a domain is an ingress point, not a
 * resource — with the host in mono per the Two-Cuts rule. The traffic edge
 * hanging off it carries the live stats; the pill itself stays static.
 */

import { EarthIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";

import { cn } from "@/shared/lib/utils";

export function RouteNode({ data, selected }: NodeProps<Node<ResourceNodeData, "route">>) {
  return (
    <div className="relative">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border bg-card py-2 pr-4 pl-3.5",
          "shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)] transition-all",
          selected && "ring-2 ring-ring/40",
        )}
      >
        <HugeiconsIcon
          icon={EarthIcon}
          strokeWidth={2}
          className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-300"
        />
        <span className="font-mono text-[12px] leading-none text-foreground/85">{data.name}</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="size-2! border-[1.5px]! border-border! bg-card!"
      />
    </div>
  );
}
