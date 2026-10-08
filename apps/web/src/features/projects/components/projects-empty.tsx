/**
 * The org home with no projects yet.
 *
 * It does NOT own the "New project" dialog, on purpose. Creating
 * a project inserts an optimistic row, the list is no longer empty, and this
 * component unmounts on the very next render, taking a dialog it owned with
 * it. The dialog closed the instant Create was clicked, the page showed the
 * list, and the jump into the new project arrived a round trip or two later,
 * which read as "it stayed on the list". The route owns one dialog for both
 * states, so it stays open on "Creating…" until it navigates.
 */

import { FolderIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";

export function ProjectsEmpty({
  organizationName,
  onNewProject,
}: {
  organizationName: string;
  onNewProject: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      {/* The page names itself even when empty. */}
      <h1 className="sr-only">Projects</h1>
      <Empty className="h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={FolderIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>No projects in {organizationName}</EmptyTitle>
          <EmptyDescription>
            Projects group services, databases, and routes. Create your first one to get started.
          </EmptyDescription>
          <Button className="mt-4" onClick={onNewProject}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            New project
          </Button>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
