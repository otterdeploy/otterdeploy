import { useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Key01Icon } from "@hugeicons/core-free-icons";

import { Page, PageHeader } from "@/shared/components/page";
import { JoinTokenDialog } from "@/features/servers/components/join-token-dialog";
import { ServerCreateDialog } from "@/features/servers/components/server-create-dialog";
import { serverCollection } from "@/features/servers/data/server";
import { serverHealthCollection } from "@/features/servers/data/health";
import {
  serverClusterStatsCollection,
  serverNodeStatsCollection,
} from "@/features/servers/data/stats";
import { Button } from "@/shared/components/ui/button";

import { ServerHealthCard } from "./-components/servers-health";
import { ServerHealthSheet } from "./-components/servers-health-sheet";
import { ClusterStatTiles, FilterPill, ServersPending } from "./-components/servers-parts";
import { ServersTable } from "./-components/servers-table";

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
  // Latest per-server health snapshots (local sampler + swarm agents, 30s
  // poll) — feeds the Live column and the row detail sheet.
  const { data: healthArr = [] } = useLiveQuery(() => serverHealthCollection);
  const [openServerId, setOpenServerId] = useState<string | null>(null);
  const healthByServer = useMemo(() => {
    type HealthEntry = (typeof healthArr)[number];
    const map = new Map<string, HealthEntry>();
    for (const h of healthArr) map.set(h.serverId, h);
    return map;
  }, [healthArr]);
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

  const nodeCount = servers.length;

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

      <ClusterStatTiles servers={servers} tasksRunning={cluster?.tasksRunning ?? null} />

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

      <ServersTable
        servers={visibleServers}
        statsByServer={perServerStats}
        healthByServer={healthByServer}
        onOpenServer={setOpenServerId}
        onCreate={() => setCreateOpen(true)}
      />

      {/* The LOCAL host's action surface (reclaim/grow run on the local
          docker socket). Per-server snapshots live in the rows + sheet. */}
      <ServerHealthCard />

      <ServerHealthSheet
        server={servers.find((s) => s.id === openServerId) ?? null}
        entry={openServerId ? (healthByServer.get(openServerId) ?? null) : null}
        onOpenChange={(open) => {
          if (!open) setOpenServerId(null);
        }}
      />
      <ServerCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <JoinTokenDialog open={tokenOpen} onOpenChange={setTokenOpen} />
    </Page>
  );
}
