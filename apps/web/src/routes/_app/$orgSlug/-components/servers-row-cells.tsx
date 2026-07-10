/**
 * Presentational cells for a Servers table row — name/host/labels block,
 * cpu+mem usage bars, and the role / status badges. Split from
 * `servers-row.tsx`, which keeps the row itself and its availability control.
 */
import { HugeiconsIcon } from "@hugeicons/react";
import { ServerStack01Icon } from "@hugeicons/core-free-icons";

import { type Server } from "@/features/servers/data/server";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";

export function ServerNameCell({ server }: { server: Server }) {
  return (
    <div className="flex items-start gap-2.5">
      <HugeiconsIcon
        icon={ServerStack01Icon}
        strokeWidth={1.8}
        className="mt-0.5 size-4 shrink-0 text-muted-foreground/70"
      />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[13px] font-medium">{server.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono">{server.host}</span>
          {server.hostname && server.hostname !== server.name && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="font-mono">{server.hostname}</span>
            </>
          )}
        </div>
        {server.labels.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {server.labels.map((label) => (
              <Badge
                key={label}
                variant="outline"
                className="h-4 px-1.5 font-mono text-[10px] font-normal text-muted-foreground"
              >
                {label}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function UsageBars({
  cpuUsed,
  cpuTotal,
  memUsed,
  memTotal,
  draining,
}: {
  cpuUsed: number;
  cpuTotal: number;
  memUsed: number;
  memTotal: number;
  draining: boolean;
}) {
  const cpuPct = cpuTotal > 0 ? Math.min(100, (cpuUsed / cpuTotal) * 100) : 0;
  const memPct = memTotal > 0 ? Math.min(100, (memUsed / memTotal) * 100) : 0;
  const fill = draining ? "bg-warning" : "bg-muted-foreground/40";
  const knownCapacity = cpuTotal > 0 || memTotal > 0;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <UsageRow label="cpu" used={cpuUsed} total={cpuTotal} unit="vCPU" pct={cpuPct} fill={fill} unknown={!knownCapacity} />
      <UsageRow label="mem" used={memUsed} total={memTotal} unit="GB" pct={memPct} fill={fill} unknown={!knownCapacity} />
    </div>
  );
}

function UsageRow({
  label,
  used,
  total,
  unit,
  pct,
  fill,
  unknown,
}: {
  label: string;
  used: number;
  total: number;
  unit: string;
  pct: number;
  fill: string;
  unknown: boolean;
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px]">
      <span className="w-7 shrink-0 text-muted-foreground">{label}</span>
      <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", fill)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-[110px] shrink-0 text-right tabular-nums text-muted-foreground">
        {unknown ? (
          <span className="text-muted-foreground/40">— / — {unit}</span>
        ) : (
          <>
            <span className="text-foreground">{used}</span>
            <span className="text-muted-foreground"> / {total} {unit}</span>
          </>
        )}
      </span>
    </div>
  );
}

export function RoleBadge({ role, leader }: { role: Server["role"]; leader: boolean }) {
  const tone =
    role === "manager"
      ? "border-info/30 bg-info/10 text-info"
      : "border-border bg-muted text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className={cn("h-5 px-1.5 font-mono text-[10px] font-medium", tone)}>
        {role}
      </Badge>
      {leader && (
        <Badge
          variant="outline"
          className="h-5 border-success/30 bg-success/10 px-1.5 font-mono text-[10px] font-medium text-success"
        >
          leader
        </Badge>
      )}
    </span>
  );
}

export function StatusBadge({
  status,
  availability,
}: {
  status: Server["status"];
  availability: Server["availability"];
}) {
  const tone =
    status === "ready" && availability === "active"
      ? "bg-success/15 text-success border-success/30"
      : status === "draining" || availability === "drain"
        ? "bg-warning/15 text-warning border-warning/30"
        : status === "down"
          ? "bg-destructive/15 text-destructive border-destructive/30"
          : "bg-muted text-muted-foreground border-border";
  const label =
    availability === "drain" ? "draining" : availability === "pause" ? "paused" : status;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium",
        tone,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "ready" && availability === "active"
            ? "bg-success"
            : status === "down"
              ? "bg-destructive"
              : "bg-warning",
        )}
      />
      {label}
    </span>
  );
}
