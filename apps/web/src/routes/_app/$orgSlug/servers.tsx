import { createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CpuIcon,
  HardDriveIcon,
  RamMemoryIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";

import { NODES, type Node } from "@/features/projects/data/service-kinds";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
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
  component: ServersRoute,
});

function ServersRoute() {
  const totalCpu = NODES.reduce((acc, n) => acc + n.cpu.total, 0);
  const usedCpu = NODES.reduce((acc, n) => acc + n.cpu.used, 0);
  const totalMem = NODES.reduce((acc, n) => acc + n.mem.total, 0);
  const usedMem = NODES.reduce((acc, n) => acc + n.mem.used, 0);
  const totalServices = NODES.reduce((acc, n) => acc + n.services, 0);

  return (
    <div className="flex flex-1 flex-col gap-5 p-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Docker Swarm nodes available to this workspace. Resources here back every project.
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5">
          + Add server
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={ServerStack01Icon}
          label="Nodes"
          value={`${NODES.length}`}
          sub={`${NODES.filter((n) => n.status === "ready").length} ready`}
        />
        <StatTile
          icon={CpuIcon}
          label="CPU"
          value={`${usedCpu.toFixed(1)} / ${totalCpu}`}
          sub="vCPU in use"
        />
        <StatTile
          icon={RamMemoryIcon}
          label="Memory"
          value={`${usedMem} / ${totalMem} GB`}
          sub="RAM allocated"
        />
        <StatTile
          icon={HardDriveIcon}
          label="Services"
          value={`${totalServices}`}
          sub="running across all nodes"
        />
      </div>

      <Card className="overflow-hidden rounded-md p-0 gap-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="pl-4">Node</TableHead>
              <TableHead>Host</TableHead>
              <TableHead className="w-[160px]">CPU</TableHead>
              <TableHead className="w-[160px]">Memory</TableHead>
              <TableHead className="w-[160px]">Disk</TableHead>
              <TableHead className="text-center">Services</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4 text-right">Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {NODES.map((node) => (
              <ServerRow key={node.id} node={node} />
            ))}
          </TableBody>
        </Table>
      </Card>
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

function ServerRow({ node }: { node: Node }) {
  return (
    <TableRow>
      <TableCell className="pl-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-medium">{node.name}</span>
          <RoleBadge role={node.role} />
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {node.region}
          {node.labels && node.labels.length > 0 && ` · ${node.labels.join(" · ")}`}
        </div>
      </TableCell>
      <TableCell className="font-mono text-[12px] text-muted-foreground">{node.host}</TableCell>
      <TableCell>
        <Usage used={node.cpu.used} total={node.cpu.total} unit="vCPU" />
      </TableCell>
      <TableCell>
        <Usage used={node.mem.used} total={node.mem.total} unit="GB" />
      </TableCell>
      <TableCell>
        {node.disk ? (
          <Usage used={node.disk.used} total={node.disk.total} unit={node.disk.unit} />
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </TableCell>
      <TableCell className="text-center font-mono text-sm">{node.services}</TableCell>
      <TableCell>
        <StatusBadge status={node.status} availability={node.availability} />
      </TableCell>
      <TableCell className="pr-4 text-right text-[12px] text-muted-foreground">
        {node.joined}
      </TableCell>
    </TableRow>
  );
}

function Usage({ used, total, unit }: { used: number; total: number; unit: string }) {
  const pct = total === 0 ? 0 : Math.min(100, Math.round((used / total) * 100));
  const tone =
    pct >= 85
      ? "bg-destructive"
      : pct >= 65
        ? "bg-warning"
        : "bg-foreground/70";
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[11.5px] text-muted-foreground">
        <span className="text-foreground">{used}</span>
        {" / "}
        {total} {unit}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: Node["role"] }) {
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
  status: Node["status"];
  availability: Node["availability"];
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
