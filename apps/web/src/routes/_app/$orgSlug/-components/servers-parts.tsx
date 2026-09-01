import type { ReactNode } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  CpuIcon,
  RamMemoryIcon,
  ServerStack01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";

import type { ServerHealthEntry } from "@/features/servers/data/health";

import { formatBytes } from "@otterdeploy/shared/format";

import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

type IconType = Parameters<typeof HugeiconsIcon>[0]["icon"];

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: IconType;
  label: string;
  value: string;
  sub: string;
}) {
  const isPlaceholder = value === "–";
  return (
    // min-w-0 on the Card itself, not just the text block: as a grid item its
    // default min-width:auto lets a long label set the column's minimum and
    // widen the grid past the viewport on a phone.
    <Card className="min-w-0 gap-0 rounded-md py-3 sm:py-4">
      <CardContent className="flex min-w-0 items-center gap-3 px-3 sm:px-4">
        <div className="hidden size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground sm:inline-flex">
          <HugeiconsIcon icon={icon} strokeWidth={1.8} className="size-4 shrink-0" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
            <HugeiconsIcon icon={icon} strokeWidth={1.8} className="size-3.5 shrink-0 sm:hidden" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
          </div>
          <div
            className={cn(
              "mt-1 text-lg leading-tight font-semibold",
              isPlaceholder && "text-muted-foreground/40",
            )}
          >
            {value}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            {sub}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface FleetServer {
  id: string;
  cpuTotal: number;
  memTotalGb: number;
}

/** Capacity from the registered rows; utilization from whichever hosts are
 *  reporting. The two are kept apart in the copy: "14 vCPU" is what you have,
 *  "34% in use" is what is happening on the boxes that told us. */
function fleetTotals(
  servers: readonly FleetServer[],
  healthByServer: ReadonlyMap<string, ServerHealthEntry>,
) {
  let vcpu = 0;
  let memGb = 0;
  let cpuWeighted = 0;
  let cpuCores = 0;
  let memUsedBytes = 0;
  let memReporting = 0;
  for (const s of servers) {
    vcpu += s.cpuTotal;
    memGb += s.memTotalGb;
    const entry = healthByServer.get(s.id);
    // A stale report is a memory, not a reading: it stays off the fleet
    // totals so "0 of 1 reporting" and "23.9 GB in use" cannot share a row.
    const health = entry && !entry.stale ? entry.health : null;
    if (!health) continue;
    if (health.cpu) {
      cpuWeighted += health.cpu.usedPct * health.cpu.coreCount;
      cpuCores += health.cpu.coreCount;
    }
    memUsedBytes += health.memory.totalBytes - health.memory.availableBytes;
    memReporting += 1;
  }
  return {
    vcpu,
    memGb,
    cpuPct: cpuCores > 0 ? cpuWeighted / cpuCores : null,
    memUsedBytes: memReporting > 0 ? memUsedBytes : null,
  };
}

/** The four fleet tiles above the server cards. */
export function FleetTiles({
  servers,
  reporting,
  attention,
  tasksRunning,
  isSwarm,
  healthByServer,
}: {
  servers: readonly FleetServer[];
  reporting: number;
  attention: number;
  tasksRunning: number | null;
  /** Plain Docker counts otterdeploy-managed containers through the same
   *  field; the label says which. */
  isSwarm: boolean;
  healthByServer: ReadonlyMap<string, ServerHealthEntry>;
}) {
  const t = fleetTotals(servers, healthByServer);
  const n = servers.length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile
        icon={ServerStack01Icon}
        label="Servers"
        value={String(n)}
        sub={
          attention > 0
            ? `${reporting} of ${n} reporting · ${attention} need${attention === 1 ? "s" : ""} attention`
            : `${reporting} of ${n} reporting`
        }
      />
      <StatTile
        icon={CpuIcon}
        label="CPU"
        value={t.vcpu > 0 ? `${t.vcpu} vCPU` : "–"}
        sub={t.cpuPct === null ? "capacity · no utilization reported" : `${Math.round(t.cpuPct)}% in use`}
      />
      <StatTile
        icon={RamMemoryIcon}
        label="Memory"
        value={t.memGb > 0 ? `${t.memGb} GB` : "–"}
        sub={t.memUsedBytes === null ? "capacity · no utilization reported" : `${formatBytes(t.memUsedBytes, 1)} in use`}
      />
      <StatTile
        icon={Task01Icon}
        label={isSwarm ? "Tasks running" : "Containers running"}
        value={tasksRunning != null ? String(tasksRunning) : "–"}
        sub={isSwarm ? "across all replicas" : "otterdeploy-managed"}
      />
    </div>
  );
}

export function FilterPill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
        active
          ? "border-foreground bg-card text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted",
      )}
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}

/** The project pills beside the Servers heading: filter the grid to one
 *  project's placements. */
export function ProjectFilters({
  cluster,
  selected,
  onSelect,
}: {
  cluster: { tasksRunning: number; projects: { slug: string; name: string; tasksRunning: number }[] };
  selected: string;
  onSelect: (project: string) => void;
}) {
  if (cluster.projects.length === 0) return null;
  return (
    <>
      <FilterPill
        active={selected === "all"}
        label="All projects"
        count={cluster.tasksRunning}
        onClick={() => onSelect("all")}
      />
      {cluster.projects.map((project) => (
        <FilterPill
          key={project.slug}
          active={selected === project.slug}
          label={project.name}
          count={project.tasksRunning}
          onClick={() => onSelect(project.slug)}
        />
      ))}
    </>
  );
}

/** A section heading inside the page: title, count, and an optional right slot. */
export function SectionHeading({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="text-[13px] font-semibold">
        {title}
        {count !== undefined && (
          <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
            {count}
          </span>
        )}
      </h2>
      {children && <div className="ml-auto flex flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  );
}
