import { useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CpuIcon,
  Key01Icon,
  RamMemoryIcon,
  ServerStack01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";

import { Page, PageHeader } from "@/shared/components/page";
import { JoinTokenDialog } from "@/features/servers/components/join-token-dialog";
import { ServerCreateDialog } from "@/features/servers/components/server-create-dialog";
import { serverCollection } from "@/features/servers/data/server";
import {
  serverClusterStatsCollection,
  serverNodeStatsCollection,
} from "@/features/servers/data/stats";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import { FilterPill, ServersPending, StatTile } from "./-components/servers-parts";
import { ServerRow } from "./-components/servers-row";

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
