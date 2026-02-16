import type { NodeProps } from "@xyflow/react";

import { Handle, Position } from "@xyflow/react";
import { AlertTriangle, Database, Globe, HardDrive, Network, Workflow } from "lucide-react";

import { Badge } from "@otterstack/ui/components/ui/badge";
import { cn } from "@otterstack/ui/lib/utils";

import type { ResourceNode, ResourceNodeData } from "./types";

function KindIcon({ kind }: { kind: ResourceNodeData["kind"] }) {
  if (kind === "web") {
    return <Globe className="size-4" />;
  }

  if (kind === "api") {
    return <Workflow className="size-4" />;
  }

  if (kind === "worker") {
    return <Network className="size-4" />;
  }

  if (kind === "database") {
    return <Database className="size-4" />;
  }

  if (kind === "cache") {
    return <HardDrive className="size-4" />;
  }

  return <HardDrive className="size-4" />;
}

const statusClassName: Record<ResourceNodeData["status"], string> = {
  online: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  degraded: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  crashed: "bg-red-500/15 text-red-300 border-red-500/40",
  unknown: "bg-slate-500/15 text-slate-300 border-slate-500/40",
  deploying: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  stopped: "bg-slate-500/15 text-slate-400 border-slate-500/40",
};

export function ResourceNodeCard({ selected, data }: NodeProps<ResourceNode>) {
  const isCrashed = data.status === "crashed";

  return (
    <div
      className={cn(
        "group w-64 rounded-xl border border-white/10 bg-[#131728]/90 p-3 text-slate-100 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_10px_40px_rgba(1,1,8,0.45)] backdrop-blur",
        selected && "ring-2 ring-sky-400/70",
        isCrashed && "border-red-500/60",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border !border-slate-500 !bg-slate-900"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border !border-slate-500 !bg-slate-900"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-white/5 p-1.5 text-slate-200">
            <KindIcon kind={data.kind} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{data.name}</p>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{data.kind}</p>
          </div>
        </div>
        {isCrashed ? <AlertTriangle className="size-4 shrink-0 text-red-400" /> : null}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-2">
        <Badge variant="outline" className={cn("border text-[11px]", statusClassName[data.status])}>
          {data.status}
        </Badge>
        <span className="text-[11px] text-slate-400">resource</span>
      </div>
    </div>
  );
}
