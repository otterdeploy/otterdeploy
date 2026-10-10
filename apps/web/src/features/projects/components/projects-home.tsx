/**
 * The project list: the org home (`/$orgSlug`) and `/$orgSlug/projects`.
 * One component for both addresses, so the two can never drift apart.
 */
import { FolderIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";
import { useLoaderData } from "@tanstack/react-router";

import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { ProjectList } from "@/features/projects/components/project-list";
import { ProjectsSkeleton } from "@/features/projects/components/projects-skeleton";
import { projectCollection } from "@/features/projects/data/project";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import { orpc, queryClient } from "@/shared/server/orpc";

export function ProjectsHome({ orgSlug }: { orgSlug: string }) {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });

  const { data: projects, isLoading } = useLiveQuery((q) => q.from({ todo: projectCollection }));

  const lastError = projectCollection.utils.lastError;

  if (isLoading) return <ProjectsSkeleton />;

  if (lastError)
    return (
      <ErrorState
        title="Couldn't load projects"
        message={lastError.message}
        onRetry={() =>
          void queryClient.invalidateQueries({
            queryKey: orpc.project.list.queryKey(),
          })
        }
      />
    );

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        {/* The page names itself even when empty. */}
        <h1 className="sr-only">Projects</h1>
        <Empty className="h-full border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={FolderIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>No projects in {organization.name}</EmptyTitle>
            <EmptyDescription>
              Projects group services, databases, and routes. Create your first one to get started.
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
