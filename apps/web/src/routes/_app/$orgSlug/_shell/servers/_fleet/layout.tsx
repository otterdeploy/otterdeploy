import { useState } from "react";

import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/shared/components/page";
import { serverCollection } from "@/features/servers/data/server";
import { serverHealthCollection } from "@/features/servers/data/health";
import {
  serverClusterStatsCollection,
  serverNodeStatsCollection,
} from "@/features/servers/data/stats";
import {
  swarmNodesCollection,
  type SwarmNode,
  type SwarmNodesView,
} from "@/features/servers/data/swarm";
import { fleetAttention } from "@/features/servers/detail/fleet-attention";
import { deriveServerState, isReporting } from "@/features/servers/detail/server-state";
import { Button } from "@/shared/components/ui/button";

import { FleetAttention } from "../-components/servers-fleet-attention";
import { ServerFleetGrid } from "../-components/servers-fleet-grid";
import { ManagersQuorumCard } from "../-components/servers-managers-card";
import { FleetTiles, ProjectFilters, SectionHeading } from "../-components/servers-parts";
import { ServersPending } from "../-components/servers-pending";
import { serverDisplayName } from "@/features/servers/detail/server-facts";

// Pulled out of ServersRoute (rather than inline IIFEs) to keep the
// component's own branching under the complexity budget. These are pure
// reshapes with no hook or JSX involvement.
function toMapBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(keyOf(item), item);
  return map;
}

function swarmNodesByServer(view: SwarmNodesView | null): Map<string, SwarmNode> {
  const map = new Map<string, SwarmNode>();
  if (!view?.swarm) return map;
  for (const n of view.nodes) {
    if (n.serverId) map.set(n.serverId, n);
  }
  return map;
}

function visibleServersForProject<T extends { id: string }>(
  servers: T[],
  stats: Map<string, { projects: string[] }>,
  project: string,
): T[] {
  if (project === "all") return servers;
  return servers.filter((server) => stats.get(server.id)?.projects.includes(project));
}

function countBy(items: ReadonlyArray<{ serverId: string }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) map.set(item.serverId, (map.get(item.serverId) ?? 0) + 1);
  return map;
}

/** The subtitle names the runtime: a swarm places replicas across nodes;
 *  plain Docker runs every service on the control plane. */
function fleetSubtitleKey(isSwarm: boolean) {
  return isSwarm ? "servers.nodeDescription" : "servers.nodeDescriptionDocker";
}

/** The one way in. Both methods (a command, or SSH) are tabs inside it. */
function AddServerButton({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      className="h-8 gap-1.5"
      data-tour="add-server"
      nativeButton={false}
      render={<Link to="/$orgSlug/servers/new/command" params={{ orgSlug }} />}
    >
      {t("servers.addServer")}
    </Button>
  );
}

/**
 * The fleet page is a pathless layout so that `/servers/new/*` can render the
 * Add a server dialog over it: the page stays mounted underneath, and closing
 * the dialog is a navigation back to `/servers`, not a state reset.
 */
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet")({
  staticData: { crumb: "Servers" },
  loader: async () => {
    await serverCollection.preload();
  },
  component: ServersRoute,
  pendingComponent: ServersPending,
});

function ServersRoute() {
  const { t } = useTranslation();
  const { orgSlug } = Route.useParams();
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }));
  const [projectFilter, setProjectFilter] = useState<string>("all");

  // Live cluster + per-node aggregates via TanStack DB collections sharing
  // a single server.stats RPC. Sync reads keep tab/filter interactions
  // instant; polling refreshes silently every 5s.
  const { data: perServerArr = [] } = useLiveQuery(() => serverNodeStatsCollection);
  const { data: clusterArr = [] } = useLiveQuery(() => serverClusterStatsCollection);
  // Latest per-server health snapshots (local sampler + swarm agents, 30s
  // poll): feeds every card's meters and the needs-attention list.
  const { data: healthArr = [] } = useLiveQuery(() => serverHealthCollection);
  // Live swarm topology (10s poll). Quorum card and leader markers.
  // `swarm: false` on plain docker.
  const { data: swarmArr = [] } = useLiveQuery(() => swarmNodesCollection);
  const swarmView = swarmArr[0] ?? null;
  const healthByServer = toMapBy(healthArr, (h) => h.serverId);
  const nodesByServer = swarmNodesByServer(swarmView);
  const cluster = clusterArr[0] ?? null;
  const perServerStats = toMapBy(perServerArr, (s) => s.serverId);

  const visibleServers = visibleServersForProject(servers, perServerStats, projectFilter);
  // The control plane is named by its hostname everywhere it is listed.
  const attention = fleetAttention(
    servers.map((s) => ({ ...s, name: serverDisplayName(s) })),
    healthByServer,
  );
  const isSwarm = swarmView?.swarm ?? false;
  const reporting = servers.filter((s) =>
    isReporting(deriveServerState(s, healthByServer.get(s.id) ?? null).kind),
  ).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0">
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <PageHeader
          title={t("servers.title")}
          description={t(fleetSubtitleKey(isSwarm), { count: servers.length })}
          actions={<AddServerButton orgSlug={orgSlug} />}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6">
        {/* 1. Capacity and how much of it is in use. */}
        <FleetTiles
          servers={servers}
          reporting={reporting}
          attention={attention.length}
          tasksRunning={cluster?.tasksRunning ?? null}
          isSwarm={swarmView?.swarm ?? false}
          healthByServer={healthByServer}
        />

        {/* 2. What needs a person, one line each. Absent when nothing does. */}
        {attention.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeading title="Needs attention" count={attention.length} />
            <FleetAttention items={attention} orgSlug={orgSlug} />
          </section>
        )}

        {/* Swarm-gated: renders nothing on the plain-docker runtime. */}
        <ManagersQuorumCard view={swarmView} />

        {/* 3. The machines. Each card opens its page; everything a box can
            do (reclaim, drain, shell, remove) lives there. */}
        <section className="flex flex-col gap-2">
          <SectionHeading title="Servers" count={servers.length}>
            {cluster ? (
              <ProjectFilters
                cluster={cluster}
                selected={projectFilter}
                onSelect={setProjectFilter}
              />
            ) : null}
          </SectionHeading>
          <ServerFleetGrid
            servers={visibleServers}
            statsByServer={perServerStats}
            healthByServer={healthByServer}
            nodesByServer={nodesByServer}
            attentionByServer={countBy(attention)}
            isSwarm={isSwarm}
            orgSlug={orgSlug}
          />
        </section>
      </div>

      {/* `/servers/new/*`: the Add a server dialog, over this page. */}
      <Outlet />
    </div>
  );
}
