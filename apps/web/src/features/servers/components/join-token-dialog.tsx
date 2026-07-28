import { useState } from "react";

import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";

import { JoinTokenPanel, type JoinRole } from "./join-token-panel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JoinTokenDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [role, setRole] = useState<JoinRole>("worker");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("servers.enrollment.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Verify with your authenticator, create a short-lived one-time command, then run it on a
          host with Docker installed. Static Swarm join tokens are never displayed.
        </p>
        <JoinTokenPanel role={role} onRoleChange={setRole} />
      </DialogContent>
    </Dialog>
  );
}
