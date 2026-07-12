import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { ResourceWizard } from "@/features/projects/components/new-resource/wizard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

import type { ComposePrefill } from "./compose-wizard-shared";

interface ResourceOverlayDialogProps {
  orgSlug: string;
  projectSlug: ProjectSlug;
  projectId: ProjectId;
  projectName?: string;
  open: boolean;
  /** When set (a template arrived via `?new=template`), skip the kind picker
   *  and open straight on the compose flow, seeded with the template. */
  composePrefill?: ComposePrefill | null;
  onOpenChange: (open: boolean) => void;
}

export function ResourceOverlayDialog({
  orgSlug,
  projectSlug,
  projectId,
  projectName,
  open,
  composePrefill,
  onOpenChange,
}: ResourceOverlayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-230">
        <DialogHeader className="border-b px-5 pt-4 pb-3">
          <DialogTitle>
            {composePrefill ? `Deploy ${composePrefill.name}` : "Deploy a new service"}
          </DialogTitle>
          <DialogDescription>
            {composePrefill ? (
              <>
                Review the template's compose file and variables
                {projectName ? (
                  <>
                    {" "}
                    for <span className="font-medium text-foreground">{projectName}</span>
                  </>
                ) : null}
                . Nothing deploys until you apply the staged change.
              </>
            ) : (
              <>
                Pick what you want to launch. Otterdeploy can build app code, pull images, import
                compose stacks, or provision a database
                {projectName ? (
                  <>
                    {" "}
                    in <span className="font-medium text-foreground">{projectName}</span>
                  </>
                ) : null}
                .
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <ResourceWizard
            // Remount when a template arrives so form seeds cleanly even if
            // the wizard was already open on another kind.
            key={composePrefill ? `tpl:${composePrefill.name}` : "picker"}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            projectId={projectId}
            projectName={projectName ?? ""}
            initialKind={composePrefill ? "compose" : undefined}
            composePrefill={composePrefill ?? undefined}
            onComplete={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
