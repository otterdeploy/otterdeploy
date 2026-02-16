import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { Button } from "@otterstack/ui/components/ui/button";
import { Skeleton } from "@otterstack/ui/components/ui/skeleton";

import { getOrganizationId, orpc } from "@/utils/orpc";
import { ProjectCard } from "@/components/dashboard/project-card";
import { CreateProjectDialog } from "@/components/dashboard/create-project-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";

export const Route = createFileRoute("/_dashboard/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const organizationId = getOrganizationId() ?? "";

  const projectsQuery = useQuery(
    orpc.project.list.queryOptions({
      input: { organizationId, page: 1, pageSize: 50 },
      enabled: !!organizationId,
    }),
  );

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground text-sm">
            Manage your infrastructure projects
          </p>
        </div>
        {projectsQuery.data && projectsQuery.data.items.length > 0 && (
          <CreateProjectDialog>
            <Button>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="mr-2 size-4" />
              New Project
            </Button>
          </CreateProjectDialog>
        )}
      </div>

      {projectsQuery.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      )}

      {projectsQuery.data && projectsQuery.data.items.length === 0 && (
        <EmptyState />
      )}

      {projectsQuery.data && projectsQuery.data.items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projectsQuery.data.items.map((project) => (
            <ProjectCard
              key={project.id}
              id={project.id}
              name={project.name}
              slug={project.slug}
              createdAt={project.createdAt}
              updatedAt={project.updatedAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}
