import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import * as z from "zod";

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
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent } from "@/shared/components/ui/tabs";

import { ServerHealthSheet } from "../-components/servers-health-sheet";
import {
  InstallAdminPlanes,
  LocalHostHealth,
  ServersTabList,
} from "../-components/servers-install-admin";
import { ManagersQuorumCard } from "../-components/servers-managers-card";
import { ClusterStatTiles, FilterPill, ServersPending } from "../-components/servers-parts";
import { ServersTable } from "../-components/servers-table";

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

function ProjectFilters({
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
    <div className="flex flex-wrap items-center gap-1.5">
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
    </div>
  );
}

// `tab` picks the section (Overview / Raw Docker / Install health, the
// latter merged in from the standalone Platform page, od-u63.4); `dockerTab`
// is forwarded from the old `/docker?tab=` deep links so a specific Docker
// sub-tab (containers/images/volumes/networks/tasks) stays reachable through
// the redirect shim.
const SERVERS_TABS = ["overview", "docker", "install-health"] as const;
type ServersTab = (typeof SERVERS_TABS)[number];

/**
 * Raw Docker (`docker.*` + `volumes.*`) and Install health (`metrics.platform`)
 * are install-admin in their entirety, so both tabs are omitted for anyone
 * else. Overview is org-scoped (`server.list` / `stats` / `health` /
 * `swarmNodes`) and stays. Except the local-host health card, which is
 * `system.hostHealth`; see `LocalHostHealth` in -components/servers-install-admin.
 */
const SERVERS_TABS_INSTALL_ADMIN: ReadonlySet<string> = new Set<ServersTab>([
  "docker",
  "install-health",
]);

/** A `?tab=docker` deep link must not reach the plane a hidden trigger just
 *  removed. Otherwise the tab is "hidden" but the 403 is one URL away. */
function resolveServersTab(tab: ServersTab, isInstallAdmin: boolean): ServersTab {
  if (isInstallAdmin || !SERVERS_TABS_INSTALL_ADMIN.has(tab)) return tab;
  return "overview";
}

/** Narrow the tab strip's string value without asserting: the tuple lookup
 *  is the type guard. */
function toServersTab(value: string): ServersTab {
  return SERVERS_TABS.find((tab) => tab === value) ?? "overview";
}

const serversSearch = z.object({
  tab: z.enum(SERVERS_TABS).catch("overview"),
  dockerTab: z.enum(["containers", "images", "volumes", "networks", "tasks", "events"]).optional(),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers")({
  staticData: { crumb: "Servers" },
  validateSearch: serversSearch,
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
  const { tab: requestedTab, dockerTab } = Route.useSearch();
  const tab = resolveServersTab(requestedTab, isInstallAdmin);
  const navigate = Route.useNavigate();
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }));
  const addDialog = useAddServerDialog();
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
  // poll): feeds the Live column and the row detail sheet.
  const { data: healthArr = [] } = useLiveQuery(() => serverHealthCollection);
  // Live swarm topology (10s poll). Quorum card, leader markers, and the
  // sheet's role/membership actions. `swarm: false` on plain docker.
  const { data: swarmArr = [] } = useLiveQuery(() => swarmNodesCollection);
  const swarmView = swarmArr[0] ?? null;
  const [openServerId, setOpenServerId] = useState<string | null>(null);
  const healthByServer = toMapBy(healthArr, (h) => h.serverId);
  const nodesByServer = swarmNodesByServer(swarmView);
  const cluster = clusterArr[0] ?? null;
  const perServerStats = toMapBy(perServerArr, (s) => s.serverId);

  const visibleServers = visibleServersForProject(servers, perServerStats, projectFilter);

  return (
    <Tabs
      value={tab}
      onValueChange={(v) =>
        void navigate({
          // Radix hands the trigger's value back as a plain string; re-brand
          // it through the same schema the route's search params use.
          search: (prev) => ({ ...prev, tab: serversSearch.shape.tab.parse(v) }),
          replace: true,
        })
      }
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

        <ServersTabList isInstallAdmin={isInstallAdmin} />
      </div>

      <TabsContent value="overview" className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6">
        <ClusterStatTiles
          servers={servers}
          tasksRunning={cluster?.tasksRunning ?? null}
          isSwarm={swarmView?.swarm ?? false}
        />

        {cluster ? (
          <ProjectFilters
            cluster={cluster}
            selected={projectFilter}
            onSelect={setProjectFilter}
          />
        ) : null}

        {/* Swarm-gated: renders nothing on the plain-docker runtime. */}
        <ManagersQuorumCard view={swarmView} />

        <ServersTable
          servers={visibleServers}
          statsByServer={perServerStats}
          healthByServer={healthByServer}
          nodesByServer={nodesByServer}
          onOpenServer={setOpenServerId}
          onCreate={addDialog.openFresh}
          onReAdd={addDialog.openWith}
        />

        {/* The LOCAL host's action surface (reclaim/grow run on the local
            docker socket). Per-server snapshots live in the rows + sheet. */}
        <LocalHostHealth isInstallAdmin={isInstallAdmin} />
      </TabsContent>

      <InstallAdminPlanes
        isInstallAdmin={isInstallAdmin}
        orgSlug={orgSlug}
        dockerTab={dockerTab}
      />

      <ServerHealthSheet
        server={servers.find((s) => s.id === openServerId) ?? null}
        entry={openServerId ? (healthByServer.get(openServerId) ?? null) : null}
        swarm={swarmView}
        onOpenChange={(open) => {
          if (!open) setOpenServerId(null);
        }}
      />
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
