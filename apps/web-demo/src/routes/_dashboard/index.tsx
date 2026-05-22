import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { ProjectList, useProjectSummaries } from "@/features/workspace-projects";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/_dashboard/")({
  component: RouteComponent,
});

function RouteComponent() {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => client.project.list(),
  });

  const projects = projectsQuery.data ?? [];

  const databaseQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["project-databases", project.id],
      queryFn: () => client.project.database.listPostgres({ projectId: project.id }),
    })),
  });

  const routeQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["project-proxy-routes", project.id],
      queryFn: () => client.project.proxyRoute.list({ projectId: project.id }),
    })),
  });

  const databaseCounts: Record<string, number | undefined> = {};
  const routeCounts: Record<string, number | undefined> = {};
  projects.forEach((project, index) => {
    databaseCounts[project.id] = databaseQueries[index]?.data?.length;
    routeCounts[project.id] = routeQueries[index]?.data?.length;
  });

  const summaries = useProjectSummaries({ projects, databaseCounts, routeCounts });

  if (projectsQuery.isLoading) {
    return (
      <div className="grid gap-4 p-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (projectsQuery.isError) {
    return (
      <div className="p-6">
        <Alert variant="error">
          <AlertCircle />
          <AlertTitle>Couldn't load projects</AlertTitle>
          <AlertDescription>
            {projectsQuery.error instanceof Error ? projectsQuery.error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <ProjectList summaries={summaries} />;
}
