/**
 * One server, as a page: the surface a system administrator opens to ask
 * "is this box healthy, what is on it, what is eating it, and what can I do
 * about it". Replaces the read-only sheet the fleet card used to open.
 *
 * `servers_.$serverId` (trailing underscore) keeps this route a SIBLING of
 * the fleet page rather than a child of it: `servers.tsx` has no Outlet and
 * owns its own tabs.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import * as z from "zod";

import { serverCollection } from "@/features/servers/data/server";
import { useServerDetail } from "@/features/servers/detail/use-server-detail";
import { isControlPlaneRow } from "@/features/servers/detail/server-state";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

import { ServerMetricsTab } from "../-components/server-detail-metrics";
import { ServerOverviewTab } from "../-components/server-detail-overview";
import { ServerServicesTab } from "../-components/server-detail-services";
import { ServerSettingsTab } from "../-components/server-detail-settings";
import { ServerLogsTab, ServerTerminalTab } from "../-components/server-detail-shell";
import { ServerStateBadge, ServerStateBanner } from "../-components/server-detail-state";
import { ServerStorageTab } from "../-components/server-detail-storage";
import { ServerUnits } from "../-components/servers-units";

const SERVER_TABS = [
  "overview",
  "metrics",
  "services",
  "units",
  "storage",
  "logs",
  "terminal",
  "settings",
] as const;
type ServerTab = (typeof SERVER_TABS)[number];

const TAB_LABEL: Record<ServerTab, string> = {
  overview: "Overview",
  metrics: "Metrics",
  services: "Services",
  units: "Units",
  storage: "Storage",
  logs: "Logs",
  terminal: "Terminal",
  settings: "Settings",
};

const serverSearch = z.object({
  tab: z.enum(SERVER_TABS).catch("overview"),
});

function ServerPending() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers_/$serverId")({
  staticData: { crumb: "Server" },
  validateSearch: serverSearch,
  loader: async () => {
    await serverCollection.preload();
  },
  component: ServerRoute,
  pendingComponent: ServerPending,
});

function NotFound({ orgSlug }: { orgSlug: string }) {
  return (
    <div className="p-4 sm:p-6">
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <EmptyTitle>No such server</EmptyTitle>
          <EmptyDescription>
            It may have been removed from this organization.{" "}
            <Link to="/$orgSlug/servers" params={{ orgSlug }} search={{ tab: "overview" }} className="underline underline-offset-4">
              Back to servers
            </Link>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

function ServerRoute() {
  const { orgSlug, serverId } = Route.useParams();
  const { isInstallAdmin } = Route.useRouteContext();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const detail = useServerDetail(serverId);
  const { server, state, health, stats, node, swarmView } = detail;

  if (!server || !state) {
    return detail.loading ? <ServerPending /> : <NotFound orgSlug={orgSlug} />;
  }

  const toFleet = () =>
    void navigate({ to: "/$orgSlug/servers", params: { orgSlug }, search: { tab: "overview" } });

  return (
    <Tabs
      value={tab}
      onValueChange={(v) =>
        void navigate({
          search: (prev) => ({ ...prev, tab: serverSearch.shape.tab.parse(v) }),
          replace: true,
        })
      }
      className="flex min-w-0 flex-1 flex-col gap-0"
    >
      <div className="border-b px-4 pt-4 pb-0 sm:px-6 sm:pt-6">
        {/* Title row: where am I, what is it called, is it up. Everything
            descriptive (role, last report, engine) is the muted line under
            it, so the title row never wraps into a chip salad. Actions live
            on the tabs (Terminal, Storage, Settings), not up here. */}
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            to="/$orgSlug/servers"
            params={{ orgSlug }}
            search={{ tab: "overview" }}
            className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
          >
            Servers
          </Link>
          <span className="shrink-0 text-muted-foreground/50">/</span>
          <h1 className="min-w-0 truncate font-mono text-lg font-semibold tracking-tight">
            {server.name}
          </h1>
          <ServerStateBadge state={state} />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {isControlPlaneRow(server) ? "control plane" : (node?.leader ? `${node.role} · leader` : (node?.role ?? server.role))}
          {" · "}
          {state.detail}
          {server.daemonVersion && ` · docker ${server.daemonVersion}`}
        </p>
        {/* Eight tabs are ~500px; on a phone the strip scrolls sideways inside
            this wrapper (the list itself is w-fit, so it cannot scroll). The
            negative margin lets the strip run edge to edge under the gutter. */}
        <div className="-mx-4 mt-3.5 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [scrollbar-width:none]">
          <TabsList variant="line" className="h-9 w-max justify-start gap-1">
            {SERVER_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
        <ServerStateBanner
          state={state}
          server={server}
          tasks={stats?.tasksRunning ?? null}
          orgSlug={orgSlug}
        />
        <TabsContent value="overview" className="flex flex-col gap-4">
          <ServerOverviewTab server={server} state={state} health={health} stats={stats} orgSlug={orgSlug} />
        </TabsContent>
        <TabsContent value="metrics" className="flex flex-col gap-4">
          <ServerMetricsTab server={server} health={health} />
        </TabsContent>
        <TabsContent value="services" className="flex flex-col gap-4">
          <ServerServicesTab server={server} stats={stats} node={node} swarmView={swarmView} orgSlug={orgSlug} />
        </TabsContent>
        <TabsContent value="units">
          {/* Own card, not the TabsContent: that one is flex-1 and would
              stretch an empty list to the bottom of the page. */}
          <div className="rounded-md bg-card pt-2 ring-1 ring-foreground/10">
            <ServerUnits serverId={server.id} />
          </div>
        </TabsContent>
        <TabsContent value="storage" className="flex flex-col gap-4">
          <ServerStorageTab server={server} health={health} state={state} isInstallAdmin={isInstallAdmin} />
        </TabsContent>
        <TabsContent value="logs">
          <ServerLogsTab server={server} />
        </TabsContent>
        <TabsContent value="terminal" className="flex min-h-0 flex-1 flex-col">
          <ServerTerminalTab server={server} orgSlug={orgSlug} />
        </TabsContent>
        <TabsContent value="settings">
          <ServerSettingsTab server={server} node={node} swarmView={swarmView} onRemoved={toFleet} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
