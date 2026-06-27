import { useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";

import { JoinTokenPanel, ManagerAddressChip, type JoinRole } from "./join-token-panel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JoinTokenDialog({ open, onOpenChange }: Props) {
  const [role, setRole] = useState<JoinRole>("worker");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Swarm join tokens</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Run on a new host once Docker is installed. The node will register with the swarm manager
          at <ManagerAddressChip />.
        </p>
        <JoinTokenPanel role={role} onRoleChange={setRole} />
      </DialogContent>
    </Dialog>
  );
}
