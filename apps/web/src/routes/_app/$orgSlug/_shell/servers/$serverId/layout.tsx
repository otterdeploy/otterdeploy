/**
 * One server, as a page: the surface a system administrator opens to ask
 * "is this box healthy, what is on it, what is eating it, and what can I do
 * about it". Replaces the read-only sheet the fleet card used to open.
 *
 * Each tab is a child route (`/servers/$serverId/containers`, `/metrics`, …)
 * that renders its own body; this layout owns the header, the tab strip and
 * the state banner. The tabs: Overview, Containers (what runs here), Metrics,
 * Storage, Logs, Terminal, Settings, and Platform on the control-plane
 * server.
 */
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { serverCollection } from "@/features/servers/data/server";
import { isControlPlaneRow } from "@/features/servers/detail/server-state";
import { useServerDetail } from "@/features/servers/detail/use-server-detail";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { pickView, useRouteView } from "@/shared/hooks/use-route-view";

import { ServerStateBadge, ServerStateBanner } from "../-components/server-detail-state";
import { SERVER_TAB_PATHS, SERVER_TABS, type ServerTab } from "../-components/server-tab-paths";
import { serverDisplayName } from "@/features/servers/detail/server-facts";

const TAB_LABEL: Record<ServerTab, string> = {
  overview: "Overview",
  containers: "Containers",
  metrics: "Metrics",
  storage: "Storage",
  logs: "Logs",
  terminal: "Terminal",
  settings: "Settings",
  platform: "Platform",
};

function ServerPending() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId")({
  staticData: { crumb: "Server" },
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
            <Link to="/$orgSlug/servers" params={{ orgSlug }} className="underline underline-offset-4">
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
  const tab = pickView(useRouteView(), 0, SERVER_TABS, "overview");
  const navigate = Route.useNavigate();
  const detail = useServerDetail(serverId);
  const { server, state, stats, node } = detail;

  if (!server || !state) {
    return detail.loading ? <ServerPending /> : <NotFound orgSlug={orgSlug} />;
  }

  const controlPlane = isControlPlaneRow(server);
  // Platform describes the install, which runs on the control plane.
  const tabs = SERVER_TABS.filter((t) => t !== "platform" || controlPlane);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = SERVER_TABS.find((t) => t === v);
          if (next) {
            void navigate({ to: SERVER_TAB_PATHS[next], params: { orgSlug, serverId }, replace: true });
          }
        }}
        className="gap-0 border-b px-4 pt-4 pb-0 sm:px-6 sm:pt-6"
      >
        {/* Title row: where am I, what is it called, is it up. Everything
            descriptive (role, last report, engine) is the muted line under
            it, so the title row never wraps into a chip salad. Actions live
            on the tabs (Terminal, Storage, Settings), not up here. */}
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            to="/$orgSlug/servers"
            params={{ orgSlug }}
            className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
          >
            Servers
          </Link>
          <span className="shrink-0 text-muted-foreground/50">/</span>
          <h1 className="min-w-0 truncate font-mono text-lg font-semibold tracking-tight">
            {serverDisplayName(server)}
          </h1>
          <ServerStateBadge state={state} />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {controlPlane ? "control plane" : (node?.leader ? `${node.role} · leader` : (node?.role ?? server.role))}
          {" · "}
          {state.detail}
          {server.daemonVersion && ` · docker ${server.daemonVersion}`}
        </p>
        {/* The strip scrolls sideways on a phone inside this wrapper (the
            list itself is w-fit, so it cannot scroll). The negative margin
            lets it run edge to edge under the gutter. */}
        <div className="-mx-4 mt-3.5 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [scrollbar-width:none]">
          <TabsList variant="line" className="h-9 w-max justify-start gap-1">
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {/* Absent when there is nothing to say (empty:hidden drops the gutter). */}
      <div className="px-4 pt-4 empty:hidden sm:px-6 sm:pt-6">
        <ServerStateBanner
          state={state}
          server={server}
          tasks={stats?.tasksRunning ?? null}
          isSwarm={detail.swarmView?.swarm ?? false}
          orgSlug={orgSlug}
        />
      </div>

      <Outlet />
    </div>
  );
}
