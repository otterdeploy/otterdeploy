import { useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { serverCollection, type Server } from "@/features/servers/data/server";
import { type ServerHealthEntry } from "@/features/servers/data/health";
import { type SwarmNode } from "@/features/servers/data/swarm";
import { orpc } from "@/shared/server/orpc";
import { Badge } from "@/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  TableCell,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import { LiveHealthCell } from "./servers-live-cell";

export interface ServerRowStats {
  tasksRunning: number;
  cpuAllocatedVcpu: number;
  memoryAllocatedGb: number;
  projects: string[];
}

export function ServerRow({
  server,
  stats,
  health,
  node,
  onOpen,
}: {
  server: Server;
  stats: ServerRowStats | null;
  health: ServerHealthEntry | null;
  /** Matching swarm node (null when plain docker / not joined) — the role
   *  column prefers swarm truth and marks the Raft leader. */
  node: SwarmNode | null;
  onOpen: () => void;
}) {
  // When stats haven't arrived yet (first paint, swarm unreachable, …) we
  // render zeros against capacity rather than fake values — honest about
  // missing live data without crashing the layout.
  const cpuUsed = stats?.cpuAllocatedVcpu ?? 0;
  const memUsed = stats?.memoryAllocatedGb ?? 0;
  const taskCount = stats?.tasksRunning ?? null;

  return (
    <TableRow className="group cursor-pointer" onClick={onOpen}>
      <TableCell className="pl-4">
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
      </TableCell>

      <TableCell>
        <RoleBadge role={node?.role ?? server.role} leader={node?.leader ?? false} />
      </TableCell>

      {/* stopPropagation: the row opens the health sheet; interacting with
          the availability select shouldn't. */}
      <TableCell onClick={(e) => e.stopPropagation()}>
        <AvailabilitySelect server={server} />
      </TableCell>

      <TableCell>
        <UsageBars
          cpuUsed={cpuUsed}
          cpuTotal={server.cpuTotal}
          memUsed={memUsed}
          memTotal={server.memTotalGb}
          draining={server.status === "draining" || server.availability === "drain"}
        />
      </TableCell>

      <TableCell>
        <LiveHealthCell health={health} />
      </TableCell>

      <TableCell className="text-right font-mono text-[12px] tabular-nums">
        {taskCount === null ? (
          <span className="text-muted-foreground/40">—</span>
        ) : (
          taskCount
        )}
      </TableCell>

      <TableCell>
        <StatusBadge status={server.status} availability={server.availability} />
      </TableCell>

      <TableCell className="pr-3">
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className="size-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
        />
      </TableCell>
    </TableRow>
  );
}

function AvailabilitySelect({ server }: { server: Server }) {
  // Optimistic local override: shows the picked value immediately, then either
  // settles it into the collection (docker confirmed the node update) or clears
  // it so the select rolls back to the persisted value (typed error → toast).
  const [pending, setPending] = useState<Server["availability"] | null>(null);
  const value = pending ?? server.availability;

  const setAvailability = (next: Server["availability"]) => {
    if (next === value) return;
    setPending(next);
    orpc.server.setAvailability
      .call({ id: server.id, availability: next })
      .then((updated) => {
        // Write the confirmed row straight into the synced store — no refetch
        // round-trip, so clearing `pending` can't flash the stale value.
        serverCollection.utils.writeUpdate(updated);
        toast.success(`${server.name}: availability set to ${next}`);
      })
      .catch((err: unknown) => {
        toast.error(
          err instanceof Error ? err.message : `Couldn't set ${server.name} to ${next}`,
        );
      })
      .finally(() => setPending(null));
  };

  return (
    <Select
      value={value}
      disabled={pending !== null}
      onValueChange={(v) => {
        if (v === "active" || v === "drain" || v === "pause") setAvailability(v);
      }}
    >
      <SelectTrigger className="h-7 w-[120px] px-2 text-[12px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">active</SelectItem>
        <SelectItem value="drain">drain</SelectItem>
        <SelectItem value="pause">pause</SelectItem>
      </SelectContent>
    </Select>
  );
}

function UsageBars({
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

function RoleBadge({ role, leader }: { role: Server["role"]; leader: boolean }) {
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

function StatusBadge({
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
