import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CpuIcon,
  HardDriveIcon,
  RamMemoryIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";

import type { serverSchema } from "@otterstack/api/routers/server/contract";
import type { z } from "zod";

import { ServerCreateDialog } from "@/features/servers/components/server-create-dialog";
import { serverCollection } from "@/features/servers/data/server";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
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
});

type Server = z.infer<typeof serverSchema>;

function ServersRoute() {
  const { data: servers = [] } = useLiveQuery((q) => q.from({ s: serverCollection }));
  const [createOpen, setCreateOpen] = useState(false);

  const totalCpu = servers.reduce((acc, s) => acc + s.cpuTotal, 0);
  const totalMem = servers.reduce((acc, s) => acc + s.memTotalGb, 0);
  const readyCount = servers.filter((s) => s.status === "ready").length;

  return (
    <div className="flex flex-1 flex-col gap-5 p-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Docker Swarm nodes available to this workspace. Resources here back every project.
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
          + Add server
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={ServerStack01Icon}
          label="Nodes"
          value={`${servers.length}`}
          sub={`${readyCount} ready`}
        />
        <StatTile
          icon={CpuIcon}
          label="CPU capacity"
          value={`${totalCpu}`}
          sub="vCPU across cluster"
        />
        <StatTile
          icon={RamMemoryIcon}
          label="Memory capacity"
          value={`${totalMem} GB`}
          sub="RAM across cluster"
        />
        <StatTile
          icon={HardDriveIcon}
          label="Managers"
          value={`${servers.filter((s) => s.role === "manager").length}`}
          sub="raft quorum participants"
        />
      </div>

      {servers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={1.5} className="size-10 text-muted-foreground/50" />
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
                <TableHead className="pl-4">Node</TableHead>
                <TableHead>Host</TableHead>
                <TableHead className="w-[140px]">CPU</TableHead>
                <TableHead className="w-[140px]">Memory</TableHead>
                <TableHead className="w-[140px]">Disk</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((server) => (
                <ServerRow key={server.id} server={server} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ServerCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
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
  return (
    <Card className="rounded-md">
      <CardContent className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <HugeiconsIcon icon={icon} strokeWidth={1.8} className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {label}
          </div>
          <div className="mt-0.5 text-lg font-semibold leading-tight">{value}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ServerRow({ server }: { server: Server }) {
  const joinedLabel = formatRelative(server.joinedAt ?? server.createdAt);
  return (
    <TableRow>
      <TableCell className="pl-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-medium">{server.name}</span>
          <RoleBadge role={server.role} />
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {server.region}
          {server.labels.length > 0 && ` · ${server.labels.join(" · ")}`}
        </div>
      </TableCell>
      <TableCell className="font-mono text-[12px] text-muted-foreground">{server.host}</TableCell>
      <TableCell className="font-mono text-[12px]">
        <span className="text-foreground">{server.cpuTotal}</span>
        <span className="text-muted-foreground"> vCPU</span>
      </TableCell>
      <TableCell className="font-mono text-[12px]">
        <span className="text-foreground">{server.memTotalGb}</span>
        <span className="text-muted-foreground"> GB</span>
      </TableCell>
      <TableCell className="font-mono text-[12px]">
        {server.diskTotalGb != null ? (
          <>
            <span className="text-foreground">{server.diskTotalGb}</span>
            <span className="text-muted-foreground"> {server.diskUnit}</span>
          </>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </TableCell>
      <TableCell>
        <StatusBadge status={server.status} availability={server.availability} />
      </TableCell>
      <TableCell className="pr-4 text-right text-[12px] text-muted-foreground">
        {joinedLabel}
      </TableCell>
    </TableRow>
  );
}

function formatRelative(when: Date | string): string {
  const d = typeof when === "string" ? new Date(when) : when;
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function RoleBadge({ role }: { role: Server["role"] }) {
  const tone =
    role === "manager"
      ? "border-info/30 bg-info/10 text-info"
      : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("h-4 px-1.5 text-[10px] font-medium uppercase", tone)}>
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
    availability === "drain"
      ? "draining"
      : availability === "pause"
        ? "paused"
        : status;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
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
