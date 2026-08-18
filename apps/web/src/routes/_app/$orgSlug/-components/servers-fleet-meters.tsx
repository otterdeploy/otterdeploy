/**
 * The meter grid and Docker-footprint footer for a fleet card
 * (servers-fleet-cards.tsx): CPU from placement stats, memory / disk /
 * branching pool from the node's health sample. Unknown readings say so
 * ("no data yet") instead of painting a zero that looks healthy.
 */
import { type ServerHealthEntry } from "@/features/servers/data/health";
import { type Server } from "@/features/servers/data/server";
import { cn } from "@/shared/lib/utils";

import { fmtBytes } from "./servers-health-pool";
import { type ServerRowStats } from "./servers-row";

export type Health = NonNullable<ServerHealthEntry["health"]>;

interface MeterProps {
  label: string;
  pct: number;
  detail: string;
  warn?: boolean;
  unknown?: boolean;
}

function cpuMeter(server: Server, stats: ServerRowStats | null): MeterProps {
  const used = stats?.cpuAllocatedVcpu ?? 0;
  const known = server.cpuTotal > 0;
  return {
    label: "CPU",
    pct: known ? (used / server.cpuTotal) * 100 : 0,
    detail: known ? `${used} / ${server.cpuTotal} vCPU` : "– / – vCPU",
    unknown: !known,
  };
}

function memMeter(mem: Health["memory"] | null): MeterProps {
  if (!mem) return { label: "Memory", pct: 0, detail: "no data yet", unknown: true };
  return {
    label: "Memory",
    pct: mem.usedPct,
    detail: `${fmtBytes(mem.totalBytes - mem.availableBytes)} / ${fmtBytes(mem.totalBytes)} · ${mem.usedPct}%`,
    warn: mem.usedPct >= 90,
  };
}

function diskMeter(disk: Health["disk"] | null): MeterProps {
  if (!disk) return { label: "Disk", pct: 0, detail: "no data yet", unknown: true };
  return {
    label: `Disk ${disk.path}`,
    pct: disk.usedPct,
    detail: `${disk.usedPct}% · ${fmtBytes(disk.freeBytes)} free`,
    warn: disk.usedPct >= 75,
  };
}

function poolMeter(pool: Health["branchPool"] | null): MeterProps {
  const max = pool?.imageMaxBytes ?? pool?.sizeBytes ?? null;
  const used = pool?.imagePhysicalBytes ?? pool?.allocBytes ?? null;
  if (!pool || max === null || used === null) {
    return { label: "Branching pool", pct: 0, detail: "no data yet", unknown: true };
  }
  const pct = (used / max) * 100;
  return {
    label: "Branching pool",
    pct,
    detail: `${fmtBytes(used)} / ${fmtBytes(max)} · ${Math.round(pct)}%`,
  };
}

function NodeMeter({ label, pct, detail, warn, unknown }: MeterProps) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex min-w-0 items-baseline justify-between gap-3">
        <span className="truncate text-[12px] text-muted-foreground" title={label}>
          {label}
        </span>
        <span
          className={cn(
            "shrink-0 font-mono text-[11px] tabular-nums",
            warn ? "text-warning" : "text-muted-foreground",
            unknown && "text-muted-foreground/40",
          )}
        >
          {detail}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", warn ? "bg-warning" : "bg-muted-foreground/40")}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

export function NodeMeters({
  server,
  stats,
  health,
}: {
  server: Server;
  stats: ServerRowStats | null;
  health: Health | null;
}) {
  const meters = [
    cpuMeter(server, stats),
    memMeter(health?.memory ?? null),
    diskMeter(health?.disk ?? null),
    poolMeter(health?.branchPool ?? null),
  ];
  return (
    <div className="grid grid-cols-1 gap-x-7 gap-y-3.5 sm:grid-cols-2">
      {meters.map((meter) => (
        <NodeMeter key={meter.label} {...meter} />
      ))}
    </div>
  );
}

export function DockerFootprint({ health }: { health: Health | null }) {
  const docker = health?.docker ?? null;
  if (!docker) return null;
  const reclaimable =
    docker.images.reclaimableBytes +
    docker.buildCache.reclaimableBytes +
    (health?.branchPool?.reclaimableBytes ?? 0);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-[11.5px] sm:px-5">
      <span className="text-muted-foreground/70">Docker</span>
      <span className="font-mono text-muted-foreground tabular-nums">
        {docker.images.count} images · {fmtBytes(docker.images.totalBytes)}
      </span>
      <span className="font-mono text-muted-foreground tabular-nums">
        {docker.volumes.count} volumes · {fmtBytes(docker.volumes.totalBytes)}
      </span>
      <span className="font-mono text-muted-foreground tabular-nums">
        build cache {fmtBytes(docker.buildCache.totalBytes)}
      </span>
      {reclaimable > 0 && (
        <span className="font-mono text-foreground/80 tabular-nums">
          {fmtBytes(reclaimable)} reclaimable
        </span>
      )}
    </div>
  );
}
