import { HugeiconsIcon } from "@hugeicons/react";
import { FolderAddIcon } from "@hugeicons/core-free-icons";
import { Button } from "@otterstack/ui/components/ui/button";

import { CreateProjectDialog } from "./create-project-dialog";

export function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted">
        <HugeiconsIcon icon={FolderAddIcon} strokeWidth={1.5} className="size-8 text-muted-foreground" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold">No projects yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Get started by creating your first project.
        </p>
      </div>
      <CreateProjectDialog>
        <Button>Create project</Button>
      </CreateProjectDialog>
    </div>
  );
}
