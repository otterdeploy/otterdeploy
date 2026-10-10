import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/shared/components/page";
import { orpc, queryClient } from "@/shared/server/orpc";
import { JoinTokenDialog } from "@/features/servers/components/join-token-dialog";
import { ServerCreateDialog } from "@/features/servers/components/server-create-dialog";
import { useAddServerDialog } from "@/features/servers/components/use-add-server-dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { pickView, useRouteView } from "@/shared/hooks/use-route-view";

import { DOCKER_TABS } from "../-components/docker-page-header";
import {
  DOCKER_TAB_PATHS,
  resolveServersTab,
  SERVERS_TAB_PATHS,
  SERVERS_TABS,
  type ServersTab,
} from "../-components/fleet-tabs";
import { InstallHealthSection } from "../-components/install-health";
import { RawDockerPanel } from "../-components/raw-docker-panel";
import { FleetAttention } from "../-components/servers-fleet-attention";
import { ServerFleetGrid } from "../-components/servers-fleet-grid";
import { ManagersQuorumCard } from "../-components/servers-managers-card";
import { FleetTiles, ProjectFilters, SectionHeading } from "../-components/servers-parts";
import { ServersPending } from "../-components/servers-pending";

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

function ServerPageActions({
  tab,
  onEnroll,
  onCreate,
}: {
  tab: ServersTab;
  onEnroll: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  if (tab !== "overview") return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        data-tour="secure-enrollment"
        onClick={onEnroll}
      >
        <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-3.5" />
        {t("servers.secureEnrollment")}
      </Button>
      <Button size="sm" className="h-8 gap-1.5" data-tour="add-server" onClick={onCreate}>
        {t("servers.addServer")}
      </Button>
    </>
  );
}

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet")({
  staticData: { crumb: "Servers" },
  loader: async ({ context }) => {
    await serverCollection.preload();
    // Warm the Install health tab's platform-metrics query on hover
    // (intent-preload), same as the standalone Platform page used to.
    // Non-blocking + best-effort, and skipped entirely for viewers who can't
    // open that tab, since a loader prefetch fires on navigation regardless of
    // which tab is rendered.
    if (context.isInstallAdmin) {
      void queryClient
        .prefetchQuery(orpc.metrics.platform.queryOptions({ input: { windowMinutes: 60 } }))
        .catch(() => undefined);
    }
  },
  component: ServersRoute,
  pendingComponent: ServersPending,
});

function ServersRoute() {
  const { t } = useTranslation();
  const { orgSlug } = Route.useParams();
  const { isInstallAdmin } = Route.useRouteContext();
  const view = useRouteView();
  const tab = resolveServersTab(pickView(view, 0, SERVERS_TABS, "overview"), isInstallAdmin);
  const dockerTab = pickView(view, 1, DOCKER_TABS, "containers");
  const navigate = Route.useNavigate();
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }));
  const addDialog = useAddServerDialog();
  const [tokenOpen, setTokenOpen] = useState(false);
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
  const attention = fleetAttention(servers, healthByServer);
  const reporting = servers.filter((s) =>
    isReporting(deriveServerState(s, healthByServer.get(s.id) ?? null).kind),
  ).length;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        const next = SERVERS_TABS.find((t) => t === v);
        if (next) void navigate({ to: SERVERS_TAB_PATHS[next], params: { orgSlug }, replace: true });
      }}
      className="flex min-w-0 flex-1 flex-col gap-0"
    >
      <div className="border-b px-4 pt-4 pb-0 sm:px-6 sm:pt-6">
        <PageHeader
          title={t("servers.title")}
          description={t("servers.nodeDescription", { count: servers.length })}
          actions={
            <ServerPageActions
              tab={tab}
              onEnroll={() => setTokenOpen(true)}
              onCreate={addDialog.openFresh}
            />
          }
        />

        <TabsList variant="line" className="mt-3.5 h-9 justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {isInstallAdmin ? (
            <>
              <TabsTrigger value="docker">Docker</TabsTrigger>
              <TabsTrigger value="install-health">Install health</TabsTrigger>
            </>
          ) : null}
        </TabsList>
      </div>

      <TabsContent value="overview" className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6">
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
            orgSlug={orgSlug}
            onCreate={addDialog.openFresh}
            onReAdd={addDialog.openWith}
          />
        </section>
      </TabsContent>

      {/* Install-admin planes: omitted (not just hidden) for everyone else, so
          none of their admin-only queries ever fires and 403s. The server
          re-checks the same flag on each procedure. */}
      {isInstallAdmin ? (
        <>
          <TabsContent value="docker" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <RawDockerPanel
              orgSlug={orgSlug}
              tab={dockerTab}
              onTabChange={(next) =>
                void navigate({ to: DOCKER_TAB_PATHS[next], params: { orgSlug }, replace: true })
              }
            />
          </TabsContent>
          <TabsContent value="install-health" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <InstallHealthSection />
          </TabsContent>
        </>
      ) : null}

      {/* Keyed so a re-add remounts the form. TanStack Form reads
          defaultValues on mount only, so a live prop change wouldn't apply. */}
      <ServerCreateDialog
        key={addDialog.formKey}
        open={addDialog.open}
        onOpenChange={addDialog.onOpenChange}
        initial={addDialog.initial}
      />
      <JoinTokenDialog open={tokenOpen} onOpenChange={setTokenOpen} />
    </Tabs>
  );
}
