import { FolderIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";

export const Route = createFileRoute("/_app/$orgSlug/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={FolderIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>No projects in {organization.name}</EmptyTitle>
          <EmptyDescription>
            Projects group services, databases, and routes. Project
            creation ships in the next milestone.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
