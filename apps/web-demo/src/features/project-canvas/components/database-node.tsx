import { type NodeProps } from "@xyflow/react";
import { GlobeIcon, NetworkIcon } from "lucide-react";
import { DatabaseLogo } from "../brand/database-logo";
import { cn } from "@/lib/utils";
import type { DatabaseNode as DatabaseNodeType } from "../types";

const dotByStatus: Record<DatabaseNodeType["data"]["status"], string> = {
  running: "bg-emerald-500",
  starting: "bg-amber-500",
  stopped: "bg-zinc-500",
  missing: "bg-zinc-500",
  error: "bg-rose-500",
};

function statusLabel(
  status: DatabaseNodeType["data"]["status"],
  health: DatabaseNodeType["data"]["health"],
): string {
  if (status === "running") return health === "healthy" ? "Healthy" : "Running";
  if (status === "starting") return "Starting";
  if (status === "stopped") return "Stopped";
  if (status === "missing") return "Missing";
  return "Error";
}

export function DatabaseNode({ data, selected }: NodeProps<DatabaseNodeType>) {
  return (
    <div
      data-canvas-node="database"
      className={cn(
        "flex w-52 flex-col gap-1.5 rounded-xl border bg-card px-3 py-3 shadow-sm",
        selected
          ? "border-foreground/30 ring-2 ring-foreground/10"
          : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <DatabaseLogo
          value={data.engine}
          size={14}
          color="var(--muted-foreground)"
        />
        <span className="truncate text-xs font-medium">{data.name}</span>
        <span
          className={cn(
            "ml-auto size-1.5 rounded-full",
            dotByStatus[data.status],
          )}
        />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {statusLabel(data.status, data.health)}
      </div>
      <div className="grid gap-0.5 text-[10px] text-muted-foreground/80">
        <div className="flex items-center gap-1">
          <GlobeIcon className="size-2.5 shrink-0" />
          <span className="truncate">{data.publicHostname}</span>
        </div>
        <div className="flex items-center gap-1">
          <NetworkIcon className="size-2.5 shrink-0" />
          <span className="truncate">{data.internalHostname}</span>
        </div>
      </div>
    </div>
  );
}
