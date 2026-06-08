import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WorkspaceRoutesTable,
  useWorkspaceRoutes,
} from "@/features/workspace-routing";
import { client } from "@/utils/orpc";
import type { ProxyRouteFromApi } from "@/features/project-canvas/api/schema";

export const Route = createFileRoute("/_dashboard/routing")({
  component: RouteComponent,
});

function RouteComponent() {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => client.project.list(),
  });
  const projects = projectsQuery.data ?? [];

  const routeQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["project-proxy-routes", project.id],
      queryFn: () => client.project.proxyRoute.list({ projectId: project.id }),
    })),
  });

  const routesByProject: Record<
    string,
    ReadonlyArray<ProxyRouteFromApi> | undefined
  > = {};
  projects.forEach((project, index) => {
    routesByProject[project.id] = routeQueries[index]?.data;
  });

  const rows = useWorkspaceRoutes({ projects, routesByProject });
  const isLoading =
    projectsQuery.isLoading || routeQueries.some((q) => q.isLoading);

  return (
    <div className="grid gap-4 p-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Routing</h1>
        <p className="text-sm text-muted-foreground">
          All public domains across your projects. Global Caddy config (TLS
          issuer, redirects, wildcards) lands in Plan 6.
        </p>
      </div>
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <WorkspaceRoutesTable rows={rows} />
      )}
    </div>
  );
}
