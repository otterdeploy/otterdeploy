import { HugeiconsIcon } from "@hugeicons/react";
import {
  CpuIcon,
  RamMemoryIcon,
  ServerStack01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";

import { Page } from "@/shared/components/page";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Skeleton } from "@/shared/components/ui/skeleton";
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
    // default min-width:auto lets a long label ("Containers running") set the
    // column's minimum, widening the grid past the viewport on a phone.
    <Card className="min-w-0 gap-0 rounded-md py-3 sm:py-4">
      {/* Two layouts, one tile. On a phone the 36px icon chip took a third of
          the tile's width, which wrapped "Cluster memory" onto two lines and
          left the four tiles ragged and half-empty; there the icon rides
          inline with the label instead and the text gets the full width. From
          `sm` there is room for the chip, so the roomier layout returns. */}
      <CardContent className="flex min-w-0 items-center gap-3 px-3 sm:px-4">
        <div className="hidden size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground sm:inline-flex">
          <HugeiconsIcon icon={icon} strokeWidth={1.8} className="size-4 shrink-0" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
            <HugeiconsIcon
              icon={icon}
              strokeWidth={1.8}
              className="size-3.5 shrink-0 sm:hidden"
            />
            {/* Single long tokens ("otterdeploy-managed") must be allowed to
                break mid-word: a tile is ~150px of text width at 390px. */}
            <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
          </div>
          <div
            className={cn(
              "mt-1 text-lg font-semibold leading-tight",
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

/** The four cluster-capacity tiles above the node table. Extracted from
 *  ServersRoute for the lint complexity budget: the placeholder ternaries
 *  live here with the tiles they feed. */
export function ClusterStatTiles({
  servers,
  tasksRunning,
  isSwarm,
}: {
  servers: Array<{ cpuTotal: number; memTotalGb: number; role: string }>;
  tasksRunning: number | null;
  /** Whether this install is running the Swarm runtime. The plain-Docker
   *  runtime (the default) has no swarm tasks. `server.stats` counts
   *  running otterdeploy-managed CONTAINERS instead and reports them through
   *  the same field, so the tile must say so: labelling a container count
   *  "Tasks running" reads as a live contradiction next to the Docker page's
   *  Tasks tab, which is genuinely swarm-only and always empty here
   *  (od-1kc.4, "TASKS RUNNING 3" here vs "Tasks 0" there, same install). */
  isSwarm: boolean;
}) {
  const totalCpu = servers.reduce((acc, s) => acc + s.cpuTotal, 0);
  const totalMem = servers.reduce((acc, s) => acc + s.memTotalGb, 0);
  const managerCount = servers.filter((s) => s.role === "manager").length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile
        icon={CpuIcon}
        label="Cluster CPU"
        value={totalCpu > 0 ? `${totalCpu} vCPU` : "–"}
        sub="cluster capacity"
      />
      <StatTile
        icon={RamMemoryIcon}
        label="Cluster memory"
        value={totalMem > 0 ? `${totalMem} GB` : "–"}
        sub="cluster capacity"
      />
      <StatTile
        icon={Task01Icon}
        label={isSwarm ? "Tasks running" : "Containers running"}
        value={tasksRunning != null ? String(tasksRunning) : "–"}
        sub={isSwarm ? "across all replicas" : "otterdeploy-managed"}
      />
      <StatTile
        icon={ServerStack01Icon}
        label="Manager nodes"
        value={`${managerCount} / ${servers.length}`}
        sub={managerCount >= 1 ? "quorum healthy" : "no manager"}
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

export function ServersPending() {
  return (
    <Page>
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-md">
            <CardContent className="flex items-start gap-3">
              <Skeleton className="size-9 shrink-0 rounded-md" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-3 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden rounded-md p-0 gap-0">
        <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-5 w-16 rounded-sm" />
            <Skeleton className="h-7 w-24 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-5 w-20 rounded-sm" />
            <Skeleton className="size-4 rounded-sm" />
          </div>
        ))}
      </Card>
    </Page>
  );
}
