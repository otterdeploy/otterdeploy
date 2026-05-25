import { ID_PREFIX, type Slug } from "@otterstack/shared/id";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ResourceWizard } from "@/features/projects/components/new-resource/new-resource-wizard";
import { StepKind } from "@/features/projects/components/new-resource/step-kind";
import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

interface ResourceKindDialogProps {
  orgSlug: string;
  projectSlug: Slug<typeof ID_PREFIX.project>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResourceKindDialog({
  orgSlug,
  projectSlug,
  open,
  onOpenChange,
}: ResourceKindDialogProps) {
  const navigate = useNavigate();
  const [kindId, setKindId] = useState<string | null>(null);

  const pickedKind = kindId ? SERVICE_KINDS.find((k) => k.id === kindId) : null;
  const canConfigure = !!pickedKind && pickedKind.group === "data";

  const handleConfirm = () => {
    if (!canConfigure || !kindId) return;
    void navigate({
      to: "/$orgSlug/$projectSlug/new-resource",
      params: { orgSlug, projectSlug },
      search: { kind: kindId },
    });
    onOpenChange(false);
    setKindId(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setKindId(null);
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[920px]">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>Choose a resource type</DialogTitle>
          <DialogDescription>
            What kind of thing do you want to add to this project?
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-5 pb-3">
          <StepKind kindId={kindId} setKindId={setKindId} />
        </div>
        <DialogFooter className="m-0 flex-row items-center rounded-none border-t bg-card px-5 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {pickedKind && !canConfigure
              ? `${pickedKind.name} isn't wired up yet — pick a database to continue.`
              : " "}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                setKindId(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={!canConfigure}>
              Configure →
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ResourceOverlayDialogProps {
  orgSlug: string;
  projectSlug: Slug<typeof ID_PREFIX.project>;
  projectName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResourceOverlayDialog({
  orgSlug,
  projectSlug,
  projectName,
  open,
  onOpenChange,
}: ResourceOverlayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[920px]">
        <DialogHeader className="border-b px-5 pt-4 pb-3">
          <DialogTitle>
            {projectName ? `Add resource to ${projectName}` : "Add resource"}
          </DialogTitle>
          <DialogDescription>
            Configure and launch a new service for this project.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <ResourceWizard
            layout="dialog"
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            projectName={projectName ?? ""}
            onComplete={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
