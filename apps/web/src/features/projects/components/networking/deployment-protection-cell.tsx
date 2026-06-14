import { useState } from "react";
import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { ProtectionSwitch } from "@/features/projects/components/networking/protection-switch";
import { RouteAccessControls } from "@/features/projects/components/networking/route-access-controls";

interface ProtectionRoute {
  id: string;
  domain: string;
  protected: boolean;
  isHttp: boolean;
}

/**
 * Per-route deployment-protection control for the Routes table: a toggle for
 * the auth wall plus a shortcut dialog to manage guest access, a shareable
 * link, and a CI bypass token. Only meaningful for HTTP routes — layer-4
 * (database) routes can't carry a forward_auth gate. The same controls live,
 * always-visible, on the Networking → Access tab.
 */
export function DeploymentProtectionCell({
  route,
  projectId,
}: {
  route: ProtectionRoute;
  projectId: string;
}) {
  if (!route.isHttp) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[11px] text-muted-foreground">
        {route.protected ? "login required" : "public"}
      </span>
      <ProtectionSwitch route={route} projectId={projectId} />
      {route.protected ? (
        <AccessDialog routeId={route.id} domain={route.domain} />
      ) : null}
    </div>
  );
}

function AccessDialog({ routeId, domain }: { routeId: string; domain: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7" aria-label="Manage access" />
        }
      >
        <HugeiconsIcon icon={ShieldKeyIcon} strokeWidth={1.8} className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Access to {domain}</DialogTitle>
          <DialogDescription>
            Org members sign in automatically. Invite external guests by email
            (they get a one-time code, no account), or grant access with a
            shareable link or a CI header token.
          </DialogDescription>
        </DialogHeader>

        <div className="pt-1">
          <RouteAccessControls routeId={routeId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
