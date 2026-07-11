import type { ServerId } from "@otterdeploy/shared/id";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

import { ProvisionForm } from "./server-provision-form";
import { ProvisionProgress } from "./server-provision-progress";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ServerCreateDialog({ open, onOpenChange }: Props) {
  const [provisioningId, setProvisioningId] = useState<ServerId | null>(null);

  // Reset back to the form whenever the dialog is closed, so re-opening starts
  // clean rather than showing the last run's logs.
  const close = (next: boolean) => {
    if (!next) setProvisioningId(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add server</DialogTitle>
        </DialogHeader>
        {provisioningId ? (
          <ProvisionProgress serverId={provisioningId} onClose={() => close(false)} />
        ) : (
          <ProvisionForm onStarted={setProvisioningId} onCancel={() => close(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
