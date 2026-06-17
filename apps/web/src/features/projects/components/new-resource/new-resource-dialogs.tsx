import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { ResourceWizard } from "@/features/projects/components/new-resource/wizard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

interface ResourceOverlayDialogProps {
  orgSlug: string;
  projectSlug: ProjectSlug;
  projectId: ProjectId;
  projectName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResourceOverlayDialog({
  orgSlug,
  projectSlug,
  projectId,
  projectName,
  open,
  onOpenChange,
}: ResourceOverlayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-230">
        <DialogHeader className="border-b px-5 pt-4 pb-3">
          <DialogTitle>Deploy a new service</DialogTitle>
          <DialogDescription>
            Pick what you want to launch. Otterdeploy can build app code, pull
            images, import compose stacks, or provision a database
            {projectName ? (
              <>
                {" "}
                in <span className="font-medium text-foreground">{projectName}</span>
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <ResourceWizard
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            projectId={projectId}
            projectName={projectName ?? ""}
            onComplete={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
