import { useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  CpuIcon,
  Key01Icon,
  RamMemoryIcon,
  ServerStack01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";

import { Page, PageHeader } from "@/shared/components/page";
import { JoinTokenDialog } from "@/features/servers/components/join-token-dialog";
import { ServerCreateDialog } from "@/features/servers/components/server-create-dialog";
import { serverCollection, type Server } from "@/features/servers/data/server";
import {
  serverClusterStatsCollection,
  serverNodeStatsCollection,
} from "@/features/servers/data/stats";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/_app/$orgSlug/servers")({
  staticData: { crumb: "Servers" },
  loader: async () => {
    await serverCollection.preload();
  },
  component: ServersRoute,
  pendingComponent: ServersPending,
});

function ServersRoute() {
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }));
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>("all");

  // Live cluster + per-node aggregates via TanStack DB collections sharing
  // a single server.stats RPC. Sync reads keep tab/filter interactions
  // instant; polling refreshes silently every 5s.
  const { data: perServerArr = [] } = useLiveQuery(
    () => serverNodeStatsCollection,
  );
  const { data: clusterArr = [] } = useLiveQuery(
    () => serverClusterStatsCollection,
  );
  const cluster = clusterArr[0] ?? null;
  const perServerStats = useMemo(() => {
    type StatEntry = (typeof perServerArr)[number];
    const map = new Map<string, StatEntry>();
    for (const s of perServerArr) map.set(s.serverId, s);
    return map;
  }, [perServerArr]);

  const visibleServers = useMemo(() => {
    if (projectFilter === "all") return servers;
    return servers.filter((s) => {
      const ps = perServerStats.get(s.id);
      return ps?.projects.includes(projectFilter);
    });
  }, [servers, perServerStats, projectFilter]);

  const totalCpu = servers.reduce((acc, s) => acc + s.cpuTotal, 0);
  const totalMem = servers.reduce((acc, s) => acc + s.memTotalGb, 0);
  const managerCount = servers.filter((s) => s.role === "manager").length;
  const nodeCount = servers.length;
  const totalTasks = cluster?.tasksRunning ?? null;

  return (
    <Page>
      <PageHeader
        title="Servers"
        description={`${nodeCount} node${nodeCount === 1 ? "" : "s"} in this swarm · replicas placed via Docker Stack rolling updates`}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setTokenOpen(true)}>
              <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-3.5" />
              Join token
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
              + Add server
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={CpuIcon}
          label="Cluster CPU"
          value={totalCpu > 0 ? `${totalCpu} vCPU` : "—"}
          sub="cluster capacity"
        />
        <StatTile
          icon={RamMemoryIcon}
          label="Cluster memory"
          value={totalMem > 0 ? `${totalMem} GB` : "—"}
          sub="cluster capacity"
        />
        <StatTile
          icon={Task01Icon}
          label="Tasks running"
          value={totalTasks != null ? String(totalTasks) : "—"}
          sub="across all replicas"
        />
        <StatTile
          icon={ServerStack01Icon}
          label="Manager nodes"
          value={`${managerCount} / ${nodeCount}`}
          sub={managerCount >= 1 ? "quorum healthy" : "no manager"}
        />
      </div>

      {cluster && cluster.projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill
            active={projectFilter === "all"}
            label="All projects"
            count={cluster.tasksRunning}
            onClick={() => setProjectFilter("all")}
          />
          {cluster.projects.map((p) => (
            <FilterPill
              key={p.slug}
              active={projectFilter === p.slug}
              label={p.name}
              count={p.tasksRunning}
              onClick={() => setProjectFilter(p.slug)}
            />
          ))}
        </div>
      )}

      {servers.length === 0 ? (
        <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={ServerStack01Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No servers registered</EmptyTitle>
            <EmptyDescription>
              Join a host to the swarm and register it here. The orchestrator will start scheduling
              services onto it once it appears.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
              + Add server
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="overflow-hidden rounded-md p-0 gap-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-4">Hostname</TableHead>
                <TableHead className="w-[110px]">Role</TableHead>
                <TableHead className="w-[140px]">Availability</TableHead>
                <TableHead>CPU · Memory</TableHead>
                <TableHead className="w-[80px] text-right">Tasks</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[40px] pr-3" aria-label="Open" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleServers.map((server) => (
                <ServerRow
                  key={server.id}
                  server={server}
                  stats={perServerStats.get(server.id) ?? null}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ServerCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <JoinTokenDialog open={tokenOpen} onOpenChange={setTokenOpen} />
    </Page>
  );
}

function ServersPending() {
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
  const isPlaceholder = value === "—";
  return (
    <Card className="rounded-md">
      <CardContent className="flex items-center gap-3">
        <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <HugeiconsIcon
            icon={icon}
            strokeWidth={1.8}
            className="size-4 shrink-0"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {label}
          </div>
          <div
            className={cn(
              "mt-0.5 text-lg font-semibold leading-tight",
              isPlaceholder && "text-muted-foreground/40",
            )}
          >
            {value}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ServerRowStats {
  tasksRunning: number;
  cpuAllocatedVcpu: number;
  memoryAllocatedGb: number;
  projects: string[];
}

function ServerRow({
  server,
  stats,
}: {
  server: Server;
  stats: ServerRowStats | null;
}) {
  // When stats haven't arrived yet (first paint, swarm unreachable, …) we
  // render zeros against capacity rather than fake values — honest about
  // missing live data without crashing the layout.
  const cpuUsed = stats?.cpuAllocatedVcpu ?? 0;
  const memUsed = stats?.memoryAllocatedGb ?? 0;
  const taskCount = stats?.tasksRunning ?? null;

  return (
    <TableRow className="group">
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
        <RoleBadge role={server.role} />
      </TableCell>

      <TableCell>
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
  // TODO: wire to a `server.setAvailability` procedure once it lands. For now
  // the Select is controlled but the change is a no-op so the affordance is
  // visible without claiming we can actually drain a node.
  return (
    <Select value={server.availability} onValueChange={() => {}}>
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

function RoleBadge({ role }: { role: Server["role"] }) {
  const tone =
    role === "manager"
      ? "border-info/30 bg-info/10 text-info"
      : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("h-5 px-1.5 font-mono text-[10px] font-medium", tone)}>
      {role}
    </Badge>
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

function FilterPill({
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

