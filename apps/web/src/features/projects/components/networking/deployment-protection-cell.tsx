import { useState } from "react";

import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  ProtectionStateLabel,
  ProtectionSwitch,
} from "@/features/projects/components/networking/protection-switch";
import { RouteAccessControls } from "@/features/projects/components/networking/route-access-controls";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";

interface ProtectionRoute {
  id: string;
  domain: string;
  protected: boolean;
  isHttp: boolean;
}

/** Matches ProtectionStateLabel's box, so the "—" row sits at the same width. */
const LABEL_WIDTH = "w-[14ch]";

/**
 * Per-route deployment-protection control for the Routes table: a toggle for
 * the auth wall plus a shortcut dialog to manage guest access, a shareable
 * link, and a CI bypass token. Only meaningful for HTTP routes — layer-4
 * (database) routes can't carry a forward_auth gate. The same controls live,
 * always-visible, on the Networking → Access tab.
 *
 * Every branch below lays out to the same width. A cell that changes size when
 * you operate it drags the rows under the pointer, and the column is shared, so
 * one toggle re-flows every other route's cell too.
 */
export function DeploymentProtectionCell({
  route,
  projectId,
}: {
  route: ProtectionRoute;
  projectId: string;
}) {
  if (!route.isHttp) {
    return <span className={`${LABEL_WIDTH} inline-block text-muted-foreground`}>—</span>;
  }

  return (
    <div className="flex items-center gap-2.5">
      <ProtectionStateLabel isProtected={route.protected} />
      <ProtectionSwitch route={route} projectId={projectId} />
      {/* The slot is always here, empty when public: the shortcut only applies
          to a protected route, but letting it appear and vanish would resize
          the column on every toggle. */}
      <span className="flex size-7 shrink-0 items-center justify-center">
        {route.protected ? <AccessDialog routeId={route.id} domain={route.domain} /> : null}
      </span>
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
            Org members sign in automatically. Invite external guests by email (they get a one-time
            code, no account), or grant access with a shareable link or a CI header token.
          </DialogDescription>
        </DialogHeader>

        <div className="pt-1">
          <RouteAccessControls routeId={routeId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
