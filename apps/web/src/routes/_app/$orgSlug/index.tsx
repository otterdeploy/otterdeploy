import { FolderIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { ProjectList } from "@/features/projects/components/project-list";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { client, orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { orgSlug } = Route.useParams();
  const projects = useQuery({
    queryKey: orpc.project.list.queryKey(),
    queryFn: () => client.project.list(),
  });

  if (projects.isPending) {
    return null;
  }

  const items = projects.data ?? [];

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="h-full border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={FolderIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>No projects in {organization.name}</EmptyTitle>
            <EmptyDescription>
              Projects group services, databases, and routes. Create your
              first one to get started.
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
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {organization.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {items.length} project{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <CreateProjectDialog
          trigger={
            <Button size="sm">
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              New project
            </Button>
          }
        />
      </div>
      <ProjectList orgSlug={orgSlug} projects={items} />
    </div>
  );
}
