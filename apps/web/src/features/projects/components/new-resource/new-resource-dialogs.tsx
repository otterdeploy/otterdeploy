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
    // `disablePointerDismissal`: a multi-step wizard must NOT close on an
    // outside/pointer press. Beyond the UX (you'd lose staged progress on a
    // stray click), Base UI's outside-press check misfires when the clicked
    // control unmounts in the same tick — e.g. clicking "Next" swaps the footer
    // button, so the click target is gone from the DOM by the time the dismiss
    // handler runs, and it reads the in-dialog click as "outside" and closes.
    // That's the bug where the template wizard vanished before the vars step.
    // Close is still available via the ✕, Cancel, or Escape.
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
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
