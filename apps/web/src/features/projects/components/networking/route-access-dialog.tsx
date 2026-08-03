/**
 * Access controls for one route, in a dialog.
 *
 * These four sections (guests, PIN, share link, bypass token) are a full
 * editing surface — inlined in a table row they ran ~700px tall and clipped
 * their own copy at the column edge. A dialog is the same affordance the route
 * policy editor already uses from this table, so the row stays scannable and
 * the controls get the width they were designed for.
 */

import { useState } from "react";

import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { RouteAccessControls } from "@/features/projects/components/networking/route-access-controls";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

export function RouteAccessButton({
  routeId,
  domain,
  isProtected,
}: {
  routeId: string;
  domain: string;
  isProtected: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={ShieldKeyIcon} strokeWidth={2} className="size-3.5" />
        Manage access
      </Button>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Access</DialogTitle>
          <DialogDescription>
            Who can reach <span className="font-mono">{domain}</span>.{" "}
            {isProtected
              ? "The wall is on — visitors must satisfy one of the methods below."
              : "The wall is off, so this deployment is public and these methods are not enforced. Turn on Protection to apply them."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <RouteAccessControls routeId={routeId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
