import { FolderIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { ProjectList } from "@/features/projects/components/project-list";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { orpc } from "@/shared/server/orpc";

import { projectCollection } from "@/features/projects/data/project";
import { useLiveQuery } from "@tanstack/react-db";

export const Route = createFileRoute("/_app/$orgSlug/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { orgSlug } = Route.useParams();

  const {
    data: projects,
    isLoading,
    ...rest
  } = useLiveQuery((q) => q.from({ todo: projectCollection }));

  const lastError = projectCollection.utils.lastError;

  if (isLoading) return <div>Loading...</div>;

  if (lastError) return <div>Error: {lastError.message}</div>;

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="h-full border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={FolderIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>No projects in {organization.name}</EmptyTitle>
            <EmptyDescription>
              Projects group services, databases, and routes. Create your first
              one to get started.
            </EmptyDescription>
            <CreateProjectDialog
              trigger={
                <Button className="mt-4">
                  <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
                  New project
                </Button>
              }
            />
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Projects"
        description="Open a project to manage its services, databases, and routes."
        actions={
          <CreateProjectDialog
            trigger={
              <Button size="sm">
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
                New project
              </Button>
            }
          />
        }
      />
      <ProjectList orgSlug={orgSlug} projects={projects} />
    </Page>
  );
}
