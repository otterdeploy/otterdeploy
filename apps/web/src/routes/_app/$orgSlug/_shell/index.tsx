import { useState } from "react";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { ProjectList } from "@/features/projects/components/project-list";
import { ProjectsEmpty } from "@/features/projects/components/projects-empty";
import { ProjectsSkeleton } from "@/features/projects/components/projects-skeleton";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { ErrorState } from "@/shared/components/ui/error-state";
import { orpc, queryClient } from "@/shared/server/orpc";

import { projectCollection } from "@/features/projects/data/project";
import { useLiveQuery } from "@tanstack/react-db";

export const Route = createFileRoute("/_app/$orgSlug/_shell/")({
  staticData: { crumb: "Projects" },
  loader: async () => {
    await projectCollection.preload();
  },
  component: RouteComponent,
  pendingComponent: ProjectsSkeleton,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { orgSlug } = Route.useParams();
  // One dialog for both states, owned here and rendered at a fixed spot so the
  // empty -> list flip a create causes cannot unmount it mid-create (see
  // ProjectsEmpty).
  const [createOpen, setCreateOpen] = useState(false);

  const { data: projects, isLoading } = useLiveQuery((q) =>
    q.from({ todo: projectCollection }),
  );

  const lastError = projectCollection.utils.lastError;

  return (
    <>
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      {isLoading ? (
        <ProjectsSkeleton />
      ) : lastError ? (
        <ErrorState
          title="Couldn't load projects"
          message={lastError.message}
          onRetry={() =>
            void queryClient.invalidateQueries({
              queryKey: orpc.project.list.queryKey(),
            })
          }
        />
      ) : projects.length === 0 ? (
        <ProjectsEmpty
          organizationName={organization.name}
          onNewProject={() => setCreateOpen(true)}
        />
      ) : (
        <Page>
          <PageHeader
            title="Projects"
            description="Open a project to manage its services, databases, and routes."
            actions={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
                New project
              </Button>
            }
          />
          <ProjectList orgSlug={orgSlug} projects={projects} />
        </Page>
      )}
    </>
  );
}
