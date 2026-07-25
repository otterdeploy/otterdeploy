import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Key01Icon } from "@hugeicons/core-free-icons";
import * as z from "zod";

import { PageHeader } from "@/shared/components/page";
import { JoinTokenDialog } from "@/features/servers/components/join-token-dialog";
import { ServerCreateDialog } from "@/features/servers/components/server-create-dialog";
import { serverCollection } from "@/features/servers/data/server";
import { serverHealthCollection } from "@/features/servers/data/health";
import {
  serverClusterStatsCollection,
  serverNodeStatsCollection,
} from "@/features/servers/data/stats";
import { swarmNodesCollection, type SwarmNode } from "@/features/servers/data/swarm";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

import type { DockerTab } from "../-components/docker-page-header";

import { RawDockerPanel } from "../-components/raw-docker-panel";
import { ServerHealthCard } from "../-components/servers-health";
import { ServerHealthSheet } from "../-components/servers-health-sheet";
import { ManagersQuorumCard } from "../-components/servers-managers-card";
import { ClusterStatTiles, FilterPill, ServersPending } from "../-components/servers-parts";
import { ServersTable } from "../-components/servers-table";

// `tab` picks the section (Overview / Raw Docker — Install health joins in
// od-u63.4); `dockerTab` is forwarded from the old `/docker?tab=` deep links
// so a specific Docker sub-tab (containers/images/volumes/networks/tasks)
// stays reachable through the redirect shim.
const SERVERS_TABS = ["overview", "docker"] as const;
type ServersTab = (typeof SERVERS_TABS)[number];
const serversSearch = z.object({
  tab: z.enum(SERVERS_TABS).catch("overview"),
  dockerTab: z.enum(["containers", "images", "volumes", "networks", "tasks"]).optional(),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers")({
  staticData: { crumb: "Servers" },
  validateSearch: serversSearch,
  loader: async () => {
    await serverCollection.preload();
  },
  component: ServersRoute,
  pendingComponent: ServersPending,
});

function ServersRoute() {
  const { orgSlug } = Route.useParams();
  const { tab, dockerTab } = Route.useSearch();
  const navigate = Route.useNavigate();
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
  // Live swarm topology (10s poll) — quorum card, leader markers, and the
  // sheet's role/membership actions. `swarm: false` on plain docker.
  const { data: swarmArr = [] } = useLiveQuery(() => swarmNodesCollection);
  const swarmView = swarmArr[0] ?? null;
  const [openServerId, setOpenServerId] = useState<string | null>(null);
  const healthByServer = (() => {
    type HealthEntry = (typeof healthArr)[number];
    const map = new Map<string, HealthEntry>();
    for (const h of healthArr) map.set(h.serverId, h);
    return map;
  })();
  const nodesByServer = (() => {
    const map = new Map<string, SwarmNode>();
    if (swarmView?.swarm) {
      for (const n of swarmView.nodes) {
        if (n.serverId) map.set(n.serverId, n);
      }
    }
    return map;
  })();
  const cluster = clusterArr[0] ?? null;
  const perServerStats = (() => {
    type StatEntry = (typeof perServerArr)[number];
    const map = new Map<string, StatEntry>();
    for (const s of perServerArr) map.set(s.serverId, s);
    return map;
  })();

  const visibleServers =
    projectFilter === "all"
      ? servers
      : servers.filter((s) => {
          const ps = perServerStats.get(s.id);
          return ps?.projects.includes(projectFilter);
        });

  const nodeCount = servers.length;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) =>
        void navigate({
          search: (prev) => ({ ...prev, tab: v as ServersTab }),
          replace: true,
        })
      }
      className="flex flex-1 flex-col gap-0"
    >
      <div className="border-b px-6 pb-0 pt-6">
        <PageHeader
          title="Servers"
          description={`${nodeCount} node${nodeCount === 1 ? "" : "s"} in this swarm · replicas placed via Docker Stack rolling updates`}
          actions={
            tab === "overview" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setTokenOpen(true)}
                >
                  <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-3.5" />
                  Join token
                </Button>
                <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
                  + Add server
                </Button>
              </>
            ) : undefined
          }
        />

        <TabsList variant="line" className="mt-3.5 h-9 justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="docker">Raw Docker</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="flex flex-1 flex-col gap-6 p-6">
        <ClusterStatTiles
          servers={servers}
          tasksRunning={cluster?.tasksRunning ?? null}
          isSwarm={swarmView?.swarm ?? false}
        />

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

        {/* Swarm-gated: renders nothing on the plain-docker runtime. */}
        <ManagersQuorumCard view={swarmView} />

        <ServersTable
          servers={visibleServers}
          statsByServer={perServerStats}
          healthByServer={healthByServer}
          nodesByServer={nodesByServer}
          onOpenServer={setOpenServerId}
          onCreate={() => setCreateOpen(true)}
        />

        {/* The LOCAL host's action surface (reclaim/grow run on the local
            docker socket). Per-server snapshots live in the rows + sheet. */}
        <ServerHealthCard />
      </TabsContent>

      <TabsContent value="docker" className="flex min-h-0 flex-1 flex-col">
        <RawDockerPanel orgSlug={orgSlug} initialTab={dockerTab} />
      </TabsContent>

      <ServerHealthSheet
        server={servers.find((s) => s.id === openServerId) ?? null}
        entry={openServerId ? (healthByServer.get(openServerId) ?? null) : null}
        swarm={swarmView}
        onOpenChange={(open) => {
          if (!open) setOpenServerId(null);
        }}
      />
      <ServerCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <JoinTokenDialog open={tokenOpen} onOpenChange={setTokenOpen} />
    </Tabs>
  );
}
