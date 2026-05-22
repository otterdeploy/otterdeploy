import { type NodeProps } from "@xyflow/react";
import { Share2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoutingNode as RoutingNodeType } from "../types";

export function RoutingNode({ data, selected }: NodeProps<RoutingNodeType>) {
  return (
    <div
      data-canvas-node="routing"
      className={cn(
        "flex w-56 flex-col gap-1.5 rounded-xl border bg-card px-3 py-3 shadow-sm",
        selected ? "border-foreground/30 ring-2 ring-foreground/10" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <Share2Icon className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Routing</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {data.domains.length} {data.domains.length === 1 ? "route" : "routes"}
        </span>
      </div>
      {data.domains.length === 0 ? (
        <div className="text-[10px] text-muted-foreground/70">No public domains yet.</div>
      ) : (
        <ul className="grid gap-0.5">
          {data.domains.slice(0, 4).map((d) => (
            <li
              key={d.domain}
              className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/80"
            >
              <span className="truncate">{d.domain}</span>
              <span className="rounded bg-muted px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground/70">
                {d.type}
              </span>
            </li>
          ))}
          {data.domains.length > 4 ? (
            <li className="text-[10px] text-muted-foreground/60">+{data.domains.length - 4} more</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
